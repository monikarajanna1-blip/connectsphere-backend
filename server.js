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
const Schedule = require('./models/Schedule');
const User = require('./models/User');
const { buildSummary } = require('./summary');
const createRoomExtras = require('./roomExtras');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
  },
  maxHttpBufferSize: 12 * 1024 * 1024, // allows shared files up to 10 MB
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

const waitRoom = (roomId) => `wait:${roomId}`; // guests waiting for the host
const captionRoom = (roomId) => `captions:${roomId}`; // people who want live captions
const MAX_PARTICIPANTS = 6; // video gets heavy for everyone beyond this

// Run something on this room's meeting record once it exists
// (the record is created a moment after the host joins)
const withMeeting = (roomId, fn, attempt = 0) => {
  const id = roomMeetings.get(roomId);
  if (id) return fn(id);
  if (attempt < 6) setTimeout(() => withMeeting(roomId, fn, attempt + 1), 700);
};

const saveChat = (roomId, entry) =>
  withMeeting(roomId, (id) =>
    Meeting.updateOne({ _id: id }, { $push: { chat: entry } }).catch((err) =>
      console.error('Saving chat failed:', err.message)
    )
  );

const saveTitle = (roomId, title) =>
  withMeeting(roomId, (id) =>
    Meeting.updateOne({ _id: id }, { title }).catch((err) =>
      console.error('Saving title failed:', err.message)
    )
  );

const extras = createRoomExtras({ io, roomHosts, Schedule, saveChat, saveTitle });

// A scheduled meeting counts as open from creation until 2 hours after its start time
const findOpenSchedule = (roomId) =>
  Schedule.findOne({
    roomId,
    endedAt: { $exists: false },
    startsAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
  })
    .select('title startsAt')
    .lean();

const emitRoomCount = (roomId) => {
  const size = io.sockets.adapter.rooms.get(roomId)?.size || 0;
  io.to(roomId).emit('room-count', size);
};

// Put this socket in (or take it out of) the live-captions group of its room
const applyCaptionPref = (socket) => {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  if (socket.data.wantsCaptions) socket.join(captionRoom(roomId));
  else socket.leave(captionRoom(roomId));
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

  socket.on('join-room', async (raw) => {
    const payload = typeof raw === 'object' && raw !== null ? raw : { roomId: raw };
    // codes are lowercase; phones often capitalise the first letter
    const roomId = String(payload.roomId).trim().toLowerCase();
    const userId = payload.token ? userIdFromToken(payload.token) : null;
    socket.data.wantsCaptions = !!payload.captions;

    // The browser says whether it is the host, but the server double-checks:
    // a scheduled meeting can only be started by the person who scheduled it
    let asHost = !!payload.isHost;
    if (asHost) {
      try {
        const someoneElses = await Schedule.exists({ roomId, hostId: { $ne: userId || null } });
        if (someoneElses) asHost = false;
      } catch (err) {
        asHost = false;
      }
    }

    if (asHost) {
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
        // anyone waiting in the lobby can come in now
        io.to(waitRoom(roomId)).emit('host-started');
      }
    } else if (!roomHosts.has(roomId) && !roomMeetings.has(roomId)) {
      // The host has not started yet. A recently scheduled meeting waits in
      // the lobby; any other code is rejected.
      findOpenSchedule(roomId)
        .then((s) => {
          if (s) {
            socket.join(waitRoom(roomId));
            socket.emit('waiting-for-host', { title: s.title, startsAt: s.startsAt });
          } else {
            console.log(`${socket.id} tried to join an unknown room: ${roomId}`);
            socket.emit('room-not-found');
          }
        })
        .catch(() => socket.emit('room-not-found'));
      return;
    }

    // keep the call small enough for everyone's connection
    const members = io.sockets.adapter.rooms.get(roomId);
    if (members && members.size >= MAX_PARTICIPANTS && !members.has(socket.id)) {
      socket.emit('room-full');
      return;
    }

    socket.leave(waitRoom(roomId));
    socket.data.roomId = roomId;
    socket.join(roomId);
    applyCaptionPref(socket);

    // link this account to the meeting (the host was linked when it was created)
    if (!asHost) linkMember(roomId, userId);

    // start tracking this person's engagement (join-room can arrive twice)
    if (!roomStats.has(roomId)) roomStats.set(roomId, new Map());
    if (!roomStats.get(roomId).has(socket.id)) {
      const now = Date.now();
      roomStats.get(roomId).set(socket.id, {
        sid: socket.id,
        role: asHost && roomHosts.get(roomId) === socket.id ? 'Host' : 'Participant',
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
    extras.onJoin(socket, roomId, asHost, payload);
  });

  // This person switched live captions (spoken English as text) on or off
  socket.on('caption-pref', ({ on }) => {
    socket.data.wantsCaptions = !!on;
    applyCaptionPref(socket);
  });

  // Host ends the meeting: others are asked whether to continue or leave
  socket.on('end-call', (ack) => {
    const roomId = socket.data.roomId;
    if (roomId && roomHosts.get(roomId) === socket.id) {
      console.log(`Host ${socket.id} ended room ${roomId}`);
      socket.to(roomId).emit('host-ended');
      roomHosts.delete(roomId);
      Schedule.updateOne({ roomId }, { endedAt: new Date() }).catch(() => {});
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
    if (!roomId) return; // was only waiting in the lobby

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
      Schedule.updateOne({ roomId }, { endedAt: new Date() }).catch(() => {});
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

  // Spoken sentence from a participant's browser: saved for the summary,
  // and shown as a caption to people who turned live captions on
  socket.on('transcript-line', ({ text, kind }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const isSign = kind === 'sign';
    addTranscript(roomId, socket.id, isSign ? 'sign' : 'speech', text);
    const clean = String(text || '').trim().slice(0, 300);
    if (!isSign && clean) {
      socket.to(captionRoom(roomId)).emit('speech-caption', { from: socket.id, text: clean });
    }
  });

  // Words that are still being spoken: shown live to people who want captions,
  // but not saved (the finished sentence is saved by 'transcript-line')
  socket.on('speech-interim', ({ text }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const clean = String(text || '').trim().slice(0, 300);
    if (!clean) return;
    // nobody wants captions: do nothing
    if ((io.sockets.adapter.rooms.get(captionRoom(roomId))?.size || 0) === 0) return;
    socket.to(captionRoom(roomId)).volatile.emit('speech-caption', {
      from: socket.id,
      text: clean,
    });
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

  // Chat, file sharing, screen sharing, meeting name, people list.
  // This must run once per connection, so it lives here and not inside a handler.
  extras.listen(socket);
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
    title: m.title || '',
    startedAt: m.startedAt,
    endedAt: m.endedAt || null,
    ...buildSummary(m.lines || [], m.startedAt, m.endedAt, stats, now),
  };
};

// The logged-in user's meetings, newest first
app.get('/api/my-meetings', requireAuth, async (req, res) => {
  try {
    const list = await Meeting.find({ memberIds: req.userId })
      .sort({ startedAt: -1 })
      .limit(30)
      .select('roomId title startedAt endedAt hostId')
      .lean();
    res.json({
      meetings: list.map((m) => ({
        id: String(m._id),
        roomId: m.roomId,
        title: m.title || '',
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

// Is this meeting code real? Lets the Join box reject a wrong code before anyone enters a room.
// live = the host is in it, scheduled = waiting for the host to start, invalid = no such meeting
app.get('/api/rooms/:code', requireAuth, async (req, res) => {
  try {
    const code = String(req.params.code).trim().toLowerCase();
    if (roomHosts.has(code) || roomMeetings.has(code)) return res.json({ status: 'live' });
    const s = await findOpenSchedule(code);
    res.json({ status: s ? 'scheduled' : 'invalid' });
  } catch (err) {
    console.error('Room check failed:', err.message);
    res.status(500).json({ error: 'Could not check the code' });
  }
});

// ===== ACCESSIBILITY SETTINGS =====
const CAPTION_SIZES = ['small', 'medium', 'large'];
const cleanSettings = (b = {}) => ({
  liveCaptions: !!b.liveCaptions,
  speakSigns: b.speakSigns === undefined ? true : !!b.speakSigns,
  autoSign: !!b.autoSign,
  highContrast: !!b.highContrast,
  captionSize: CAPTION_SIZES.includes(b.captionSize) ? b.captionSize : 'medium',
});

app.get('/api/settings', requireAuth, async (req, res) => {
  try {
    const u = await User.findById(req.userId).select('accessibility').lean();
    res.json(cleanSettings(u?.accessibility));
  } catch (err) {
    console.error('Loading settings failed:', err.message);
    res.status(500).json({ error: 'Could not load settings' });
  }
});

app.put('/api/settings', requireAuth, async (req, res) => {
  try {
    const settings = cleanSettings(req.body);
    await User.updateOne({ _id: req.userId }, { $set: { accessibility: settings } });
    res.json(settings);
  } catch (err) {
    console.error('Saving settings failed:', err.message);
    res.status(500).json({ error: 'Could not save settings' });
  }
});

// ===== SCHEDULED MEETINGS =====
// Upcoming meetings (and ones that started in the last 2 hours)
app.get('/api/schedules', requireAuth, async (req, res) => {
  try {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const list = await Schedule.find({
      hostId: req.userId,
      endedAt: { $exists: false },
      startsAt: { $gte: since },
    })
      .sort({ startsAt: 1 })
      .limit(30)
      .lean();
    res.json({
      schedules: list.map((s) => ({
        id: String(s._id),
        title: s.title,
        startsAt: s.startsAt,
        roomId: s.roomId,
      })),
    });
  } catch (err) {
    console.error('Listing schedules failed:', err.message);
    res.status(500).json({ error: 'Could not load scheduled meetings' });
  }
});

app.post('/api/schedules', requireAuth, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim().slice(0, 80) || 'Meeting';
    const startsAt = new Date(req.body.startsAt);
    if (isNaN(startsAt.getTime())) {
      return res.status(400).json({ error: 'Please pick a date and time' });
    }
    if (startsAt.getTime() < Date.now() - 60 * 1000) {
      return res.status(400).json({ error: 'That time has already passed' });
    }

    // make a short meeting code that is not already used
    let roomId = '';
    for (let i = 0; i < 5; i++) {
      const code = Math.random().toString(36).substring(2, 9);
      if (code.length === 7 && !(await Schedule.exists({ roomId: code }))) {
        roomId = code;
        break;
      }
    }
    if (!roomId) return res.status(500).json({ error: 'Could not create a meeting code' });

    const s = await Schedule.create({ hostId: req.userId, title, startsAt, roomId });
    res.status(201).json({
      schedule: { id: String(s._id), title: s.title, startsAt: s.startsAt, roomId: s.roomId },
    });
  } catch (err) {
    console.error('Creating schedule failed:', err.message);
    res.status(500).json({ error: 'Could not schedule the meeting' });
  }
});

app.delete('/api/schedules/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: 'Not found' });
    }
    await Schedule.deleteOne({ _id: req.params.id, hostId: req.userId });
    res.json({ ok: true });
  } catch (err) {
    console.error('Deleting schedule failed:', err.message);
    res.status(500).json({ error: 'Could not delete' });
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