require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
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

// ===== SOCKET.IO SIGNALING =====
const roomHosts = new Map(); // roomId -> socket.id of the host
const roomMeetings = new Map(); // roomId -> Meeting _id in MongoDB
const roomStats = new Map(); // roomId -> Map(socketId -> engagement stats)

const emitRoomCount = (roomId) => {
  const size = io.sockets.adapter.rooms.get(roomId)?.size || 0;
  io.to(roomId).emit('room-count', size);
};

// ===== ENGAGEMENT STATS =====
const getStat = (roomId, sid) => roomStats.get(roomId)?.get(sid);

const snapshotStat = (st, now) => ({
  sid: st.sid,
  role: st.role,
  joinedAt: st.joinedAt,
  leftAt: st.leftAt || null,
  speakingMs: st.speakingMs,
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

    if (payload.isHost) {
      if (!roomHosts.has(roomId)) {
        roomHosts.set(roomId, socket.id);
        if (!roomMeetings.has(roomId)) {
          Meeting.create({ roomId })
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

// Meeting summary: the latest meeting that used this room code
app.get('/api/meetings/:roomId/summary', async (req, res) => {
  try {
    const roomId = req.params.roomId;
    const m = await Meeting.findOne({ roomId }).sort({ startedAt: -1 }).lean();
    if (!m) return res.status(404).json({ error: 'Meeting not found' });

    const now = Date.now();
    const stats = [...(m.participants || [])];
    // people still in the meeting are not saved yet, so add their live numbers
    const liveId = roomMeetings.get(roomId);
    if (liveId && String(liveId) === String(m._id)) {
      roomStats.get(roomId)?.forEach((st) => stats.push(snapshotStat(st, now)));
    }

    res.json({
      roomId: m.roomId,
      startedAt: m.startedAt,
      endedAt: m.endedAt || null,
      ...buildSummary(m.lines || [], m.startedAt, m.endedAt, stats, now),
    });
  } catch (err) {
    console.error('Summary failed:', err.message);
    res.status(500).json({ error: 'Could not build summary' });
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