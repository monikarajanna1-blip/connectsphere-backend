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
const emitRoomCount = (roomId) => {
  const size = io.sockets.adapter.rooms.get(roomId)?.size || 0;
  io.to(roomId).emit('room-count', size);
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (rawRoomId) => {
    const roomId = String(rawRoomId).trim().toLowerCase();
    socket.data.roomId = roomId;
    socket.join(roomId);
    console.log(`${socket.id} joined room ${roomId}`);

    socket.to(roomId).emit('user-joined', socket.id);
    emitRoomCount(roomId);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    console.log(`${socket.id} left room ${roomId}`);
    socket.to(roomId).emit('user-left', socket.id);
    emitRoomCount(roomId);
  });

  socket.on('offer', ({ to, offer }) => {
    console.log(`offer ${socket.id} -> ${to}`);
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    console.log(`answer ${socket.id} -> ${to}`);
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
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