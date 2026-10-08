// Extra meeting features kept out of server.js so the main file stays small:
//  - meeting title (host can rename)
//  - live participant list with names and mic state
//  - file sharing (kept in memory until the meeting is empty)
const crypto = require('crypto');

const MAX_FILE = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES = 20; // per meeting
const MAX_TOTAL = 60 * 1024 * 1024; // per meeting
const ALLOWED = /\.(pdf|docx?|pptx?|xlsx?|txt|csv|png|jpe?g)$/i;

module.exports = function createRoomExtras({ io, roomHosts, Schedule }) {
  const titles = new Map(); // roomId -> title
  const files = new Map(); // roomId -> [{ id, name, size, fromId, fromName, time, data }]

  const cleanName = (n) => String(n || '').trim().slice(0, 40) || 'Guest';

  const meta = (f) => ({
    id: f.id,
    name: f.name,
    size: f.size,
    fromId: f.fromId,
    fromName: f.fromName,
    time: f.time,
  });

  // Send everyone in the room the current list of people
  const broadcastPeople = (roomId) => {
    const ids = [...(io.sockets.adapter.rooms.get(roomId) || [])];
    const people = ids.map((id) => {
      const s = io.sockets.sockets.get(id);
      return {
        id,
        name: (s && s.data.name) || 'Guest',
        micOn: !s || s.data.micOn !== false,
        isHost: roomHosts.get(roomId) === id,
      };
    });
    io.to(roomId).emit('participants', people);
  };

  // Call this at the end of join-room, once the person is really in the room
  const onJoin = (socket, roomId, asHost, payload) => {
    socket.data.name = cleanName(payload && payload.name);
    if (socket.data.micOn === undefined) socket.data.micOn = true;

    if (asHost && !titles.has(roomId)) {
      const fallback = `${socket.data.name}'s meeting`;
      titles.set(roomId, fallback);
      // a scheduled meeting uses the title the host typed when scheduling it
      Schedule.findOne({ roomId })
        .select('title')
        .lean()
        .then((s) => {
          if (s && s.title && titles.get(roomId) === fallback) {
            titles.set(roomId, s.title);
            io.to(roomId).emit('room-title', s.title);
          }
        })
        .catch(() => {});
    }

    socket.emit('room-title', titles.get(roomId) || 'Meeting');
    socket.emit('shared-files', (files.get(roomId) || []).map(meta));
    broadcastPeople(roomId);
  };

  // Call this once per socket, after all the other socket.on(...) lines
  const listen = (socket) => {
    // Only the host can rename the meeting
    socket.on('set-title', (text) => {
      const roomId = socket.data.roomId;
      if (!roomId || roomHosts.get(roomId) !== socket.id) return;
      const t = String(text || '').trim().slice(0, 80);
      if (!t) return;
      titles.set(roomId, t);
      io.to(roomId).emit('room-title', t);
    });

    socket.on('mic-state', (state) => {
      socket.data.micOn = !!(state && state.on);
      if (socket.data.roomId) broadcastPeople(socket.data.roomId);
    });

    // The host seat changes when the host ends the call
    socket.on('end-call', () => {
      if (socket.data.roomId) broadcastPeople(socket.data.roomId);
    });

    // Anyone in the meeting can share a file
    socket.on('share-file', (f, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const roomId = socket.data.roomId;
      if (!roomId) return reply({ error: 'Join the meeting first' });

      const name = String((f && f.name) || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 120);
      const data = f && Buffer.isBuffer(f.data) ? f.data : null;
      if (!name || !data) return reply({ error: 'Invalid file' });
      if (!ALLOWED.test(name)) return reply({ error: 'This file type is not allowed' });
      if (data.length > MAX_FILE) return reply({ error: 'The file is larger than 10 MB' });

      const list = files.get(roomId) || [];
      const total = list.reduce((n, x) => n + x.size, 0);
      if (list.length >= MAX_FILES || total + data.length > MAX_TOTAL) {
        return reply({ error: 'This meeting has reached its file limit' });
      }

      const entry = {
        id: crypto.randomUUID(),
        name,
        size: data.length,
        fromId: socket.id,
        fromName: socket.data.name || 'Guest',
        time: Date.now(),
        data,
      };
      list.push(entry);
      files.set(roomId, list);
      io.to(roomId).emit('file-shared', meta(entry));
      reply({ ok: true });
    });

    // Only people inside the same meeting can download its files
    socket.on('get-file', (id, ack) => {
      if (typeof ack !== 'function') return;
      const f = (files.get(socket.data.roomId) || []).find((x) => x.id === id);
      if (!f) return ack({ error: 'File not found' });
      ack({ name: f.name, data: f.data });
    });

    // Runs after the main disconnect handler in server.js
    socket.on('disconnect', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const remaining = io.sockets.adapter.rooms.get(roomId)?.size || 0;
      if (remaining === 0) {
        titles.delete(roomId);
        files.delete(roomId);
      } else {
        broadcastPeople(roomId);
      }
    });
  };

  return { onJoin, listen };
};
