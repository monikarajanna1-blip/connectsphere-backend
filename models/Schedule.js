const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  hostId: { type: mongoose.Schema.Types.ObjectId, index: true },
  title: { type: String, default: 'Meeting' },
  startsAt: { type: Date, index: true },
  roomId: String,
  endedAt: Date,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Schedule', scheduleSchema);