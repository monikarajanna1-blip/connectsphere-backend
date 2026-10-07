require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const authRoutes = require('./routes/auth');
const Meeting = require('./models/Meeting');
const { buildSummary } = require('./summary');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);

// ===== LOGIN CHECK =====
const userIdFromToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET).userId;
  } catch (err) {
    return null;
  }
};

const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const userId = token && userIdFromToken(token);
  if (!userId) return res.status(401).json({ error: 'Please log in again' });
  req.userId = String(userId);
  next();
};

// ===== SOCKET.IO SIGNALING =====
const roomHosts = new Map(); // roomId -> socket.id of the host
const roomMeetings = new Map(); // roomId -> Meeting _id in MongoDB
const roomStats = new Map(); // roomId -> Map(socketId -> engagement stats)

const emitRoomCount = (roomId) => {
  const size = io.sockets.adapter.rooms.get(roomId)?.size || 0;
  io.to(roomId).emit('room-count', size);
};

// Remember that this account took part in the meeting
const linkMember = (roomId, userId, attempt = 0) => {
  if (!userId) return;
  const meetingId = roomMeetings.get(roomId);
  if (!meetingId) {
    // the meeting record may still be being created: try again shortly
    if (attempt < 3) setTimeout(() => linkMember(roomId, userId, attempt + 1), 1000);
    return;
  }
  Meeting.updateOne({ _id: meetingId }, { $addToSet: { memberIds: userId } }).catch((err) =>
    console.error('Linking member failed:', err.message)
  );
};

// ===== ENGAGEMENT STATS =====
const getStat = (roomId, sid) => roomStats.get(roomId)?.get(sid);

const snapshotStat = (st, now) => ({
  sid: st.sid,
  role: st.role,
  joinedAt: st.joinedAt,
  leftAt: st.leftAt || null,
  speakingMs: Math.max(st.speakingMs, st.estMs || 0),
  micOnMs: st.micOnMs + (st.micOn && !st.leftAt ? now - st.micSince : 0),
  micToggles: st.micToggles,
  speechLines: st.speechLines,
  signLines: st.signLines,
  words: st.words,
});

// ===== MEETING TRANSCRIPT (saved quietly for the summary) =====
const addTranscript = (roomId, socketId, kind, text) => {
  const clean = String(text || '').trim().slice(0, 500);
  if (!clean) return;
  const st = getStat(roomId, socketId);
  const entry = {
    from: socketId,
    role: st?.role || (roomHosts.get(roomId) === socketId ? 'Host' : 'Participant'),
    kind,
    text: clean,
    time: Date.now(),
  };
  console.log('TRANSCRIPT', roomId, entry.role, kind, clean);
  if (st) {
    if (kind === 'sign') st.signLines++;
    else {
      st.speechLines++;
      st.words += clean.split(/\s+/).length;
      st.estMs = (st.estMs || 0) + clean.split(/\s+/).length * 400;
    }
  }
  const meetingId = roomMeetings.get(roomId);
  if (meetingId) {
    Meeting.updateOne({ _id: meetingId }, { $push: { lines: entry } }).catch((err) =>
      console.error('Saving transcript line failed:', err.message)
    );
  }
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (raw) => {
    const payload = typeof raw === 'object' && raw !== null ? raw : { roomId: raw };
    const roomId = String(payload.roomId).trim();
    const userId = payload.token ? userIdFromToken(payload.token) : null;

    if (payload.isHost) {
      if (!roomHosts.has(roomId)) {
        roomHosts.set(roomId, socket.id);
        if (!roomMeetings.has(roomId)) {
          Meeting.create({
            roomId,
            hostId: userId || undefined,
            memberIds: userId ? [userId] : [],
          })
            .then((m) => roomMeetings.set(roomId, m._id))
            .catch((err) => console.error('Creating meeting failed:', err.message));
        }
      }
    } else if (!roomHosts.has(roomId) && !roomMeetings.has(roomId)) {
      console.log(`${socket.id} tried to join nonexistent room ${roomId}`);
      socket.emit('room-not-found');
      return;
    }

    socket.data.roomId = roomId;
    socket.join(roomId);

    // link this account to the meeting (the host was linked when it was created)
    if (!payload.isHost) linkMember(roomId, userId);

    // start tracking this person's engagement (join-room can arrive twice)
    if (!roomStats.has(roomId)) roomStats.set(roomId, new Map());
    if (!roomStats.get(roomId).has(socket.id)) {
      const now = Date.now();
      roomStats.get(roomId).set(socket.id, {
        sid: socket.id,
        role: payload.isHost && roomHosts.get(roomId) === socket.id ? 'Host' : 'Participant',
        joinedAt: now,
        leftAt: null,
        speakingMs: 0,
        estMs: 0,
        micOn: true,
        micSince: now,
        micOnMs: 0,
        micToggles: 0,
        speechLines: 0,
        signLines: 0,
        words: 0,
      });
    }

    console.log(`${socket.id} joined room ${roomId}`);
    socket.to(roomId).emit('user-joined', socket.id);
    emitRoomCount(roomId);
    io.to(roomId).emit('host-id', roomHosts.get(roomId) || null);
  });

  // Host ends the meeting: others are asked whether to continue or leave
  socket.on('end-call', (ack) => {
    const roomId = socket.data.roomId;
    if (roomId && roomHosts.get(roomId) === socket.id) {
      console.log(`Host ${socket.id} ended room ${roomId}`);
      socket.to(roomId).emit('host-ended');
      roomHosts.delete(roomId);
    }
    if (typeof ack === 'function') ack();
  });

  // Microphone switched on or off
  socket.on('mic-state', ({ on }) => {
    const st = getStat(socket.data.roomId, socket.id);
    if (!st) return;
    const now = Date.now();
    const next = !!on;
    if (next === st.micOn) return;
    if (st.micOn) st.micOnMs += now - st.micSince;
    st.micOn = next;
    st.micSince = now;
    st.micToggles++;
  });

  // How long this person made sound in the last few seconds
  socket.on('engagement-tick', ({ speakingMs }) => {
    const st = getStat(socket.data.roomId, socket.id);
    if (!st) return;
    st.speakingMs += Math.min(6000, Math.max(0, Number(speakingMs) || 0));
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const wasHost = roomHosts.get(roomId) === socket.id;

    if (wasHost) {
      roomHosts.delete(roomId);
      console.log(`Host ${socket.id} disconnected from room ${roomId} without ending the call`);
      socket.to(roomId).emit('host-left');
    }

    // close and save this person's engagement stats
    const st = getStat(roomId, socket.id);
    if (st) {
      const now = Date.now();
      st.leftAt = now;
      if (st.micOn) {
        st.micOnMs += now - st.micSince;
        st.micOn = false;
      }
      const meetingId = roomMeetings.get(roomId);
      if (meetingId) {
        Meeting.updateOne(
          { _id: meetingId },
          { $push: { participants: snapshotStat(st, now) } }
        ).catch((err) => console.error('Saving participant stats failed:', err.message));
      }
      roomStats.get(roomId).delete(socket.id);
    }

    console.log(`${socket.id} left room ${roomId}`);
    socket.to(roomId).emit('user-left', socket.id);
    emitRoomCount(roomId);

    // When the room is empty the meeting is over: mark it as ended
    const remaining = io.sockets.adapter.rooms.get(roomId)?.size || 0;
    if (remaining === 0) {
      const meetingId = roomMeetings.get(roomId);
      roomMeetings.delete(roomId);
      roomStats.delete(roomId);
      if (meetingId) {
        Meeting.updateOne({ _id: meetingId }, { endedAt: new Date() }).catch((err) =>
          console.error('Closing meeting failed:', err.message)
        );
      }
    }
  });

  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  // Spoken sentence from a participant's browser (saved, not shown)
  socket.on('transcript-line', ({ text, kind }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    addTranscript(roomId, socket.id, kind === 'sign' ? 'sign' : 'speech', text);
  });

  // Relay sign-language captions to everyone else in the room
  socket.on('sign-caption', ({ text, final, word }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('sign-caption', {
      from: socket.id,
      text: String(text || '').slice(0, 300),
      final: !!final,
      word,
    });
    if (word) {
      console.log('SIGN WORD', roomId, word);
      // signing counts as active time: about 2 seconds per recognised word
      const st = getStat(roomId, socket.id);
      if (st) st.speakingMs += 2000;
    }
    if (final && text) addTranscript(roomId, socket.id, 'sign', text);
  });
});

// ===== MEETING REPORTS =====
// Build the full report (summary + engagement) for one saved meeting
const reportFor = (m) => {
  const now = Date.now();
  const stats = [...(m.participants || [])];
  // people still in the meeting are not saved yet, so add their live numbers
  const liveId = roomMeetings.get(m.roomId);
  if (liveId && String(liveId) === String(m._id)) {
    roomStats.get(m.roomId)?.forEach((st) => stats.push(snapshotStat(st, now)));
  }
  return {
    id: String(m._id),
    roomId: m.roomId,
    startedAt: m.startedAt,
    endedAt: m.endedAt || null,
    ...buildSummary(m.lines || [], m.startedAt, m.endedAt, stats, now),
  };
};

// Used by the "download summary" popup at the end of a meeting
app.get('/api/meetings/:roomId/summary', async (req, res) => {
  try {
    const m = await Meeting.findOne({ roomId: req.params.roomId })
      .sort({ startedAt: -1 })
      .lean();
    if (!m) return res.status(404).json({ error: 'Meeting not found' });
    res.json(reportFor(m));
  } catch (err) {
    console.error('Summary failed:', err.message);
    res.status(500).json({ error: 'Could not build summary' });
  }
});

// The logged-in user's meetings, newest first
app.get('/api/my-meetings', requireAuth, async (req, res) => {
  try {
    const list = await Meeting.find({ memberIds: req.userId })
      .sort({ startedAt: -1 })
      .limit(30)
      .select('roomId startedAt endedAt hostId')
      .lean();
    res.json({
      meetings: list.map((m) => ({
        id: String(m._id),
        roomId: m.roomId,
        startedAt: m.startedAt,
        endedAt: m.endedAt || null,
        wasHost: String(m.hostId || '') === req.userId,
      })),
    });
  } catch (err) {
    console.error('Listing meetings failed:', err.message);
    res.status(500).json({ error: 'Could not load meetings' });
  }
});

// One of the logged-in user's meetings, with its full report
app.get('/api/my-meetings/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    const m = await Meeting.findOne({ _id: req.params.id, memberIds: req.userId }).lean();
    if (!m) return res.status(404).json({ error: 'Meeting not found' });
    res.json(reportFor(m));
  } catch (err) {
    console.error('Meeting report failed:', err.message);
    res.status(500).json({ error: 'Could not load this meeting' });
  }
});

// ===== SERVE THE BUILT REACT APP =====
app.use(express.static(path.join(__dirname, 'client/dist')));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected successfully');
    server.listen(process.env.PORT, () => {
      console.log(`Server running on http://localhost:${process.env.PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });