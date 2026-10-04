require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/auth');

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

const emitRoomCount = (roomId) => {
  const size = io.sockets.adapter.rooms.get(roomId)?.size || 0;
  io.to(roomId).emit('room-count', size);
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (raw) => {
    const payload = typeof raw === 'object' && raw !== null ? raw : { roomId: raw };
    const roomId = String(payload.roomId).trim();

    if (payload.isHost) {
      if (!roomHosts.has(roomId)) {
        roomHosts.set(roomId, socket.id);
      }
    } else if (!roomHosts.has(roomId)) {
      console.log(`${socket.id} tried to join nonexistent room ${roomId}`);
      socket.emit('room-not-found');
      return;
    }

    socket.data.roomId = roomId;
    socket.join(roomId);

    console.log(`${socket.id} joined room ${roomId}`);
    socket.to(roomId).emit('user-joined', socket.id);
    emitRoomCount(roomId);
  });

  // Host deliberately ends the call for everyone
  socket.on('end-call', (ack) => {
    const roomId = socket.data.roomId;
    if (roomId && roomHosts.get(roomId) === socket.id) {
      console.log(`Host ${socket.id} ended room ${roomId}`);
      socket.data.endedDeliberately = true;
      socket.to(roomId).emit('call-ended');
      roomHosts.delete(roomId);
    }
    if (typeof ack === 'function') ack();
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const wasHost = roomHosts.get(roomId) === socket.id;

    if (wasHost) {
      roomHosts.delete(roomId);
      // Host disappeared without pressing End Call — notify the room,
      // but don't end the call for the people still there.
      if (!socket.data.endedDeliberately) {
        console.log(`Host ${socket.id} disconnected from room ${roomId} without ending the call`);
        socket.to(roomId).emit('host-left');
      }
    }

    console.log(`${socket.id} left room ${roomId}`);
    socket.to(roomId).emit('user-left', socket.id);
    emitRoomCount(roomId);
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

  // Relay sign-language captions to everyone else in the room
  socket.on('sign-caption', ({ text, final }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('sign-caption', {
      from: socket.id,
      text: String(text || '').slice(0, 300),
      final: !!final,
    });
  });
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