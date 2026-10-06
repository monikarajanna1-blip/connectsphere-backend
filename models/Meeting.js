const mongoose = require('mongoose');

const lineSchema = new mongoose.Schema(
  {
    from: String,
    role: String, // 'Host' or 'Participant'
    kind: String, // 'speech' or 'sign'
    text: String,
    time: Number,
  },
  { _id: false }
);

const meetingSchema = new mongoose.Schema({
  roomId: { type: String, index: true },
  startedAt: { type: Date, default: Date.now },
  endedAt: Date,
  lines: [lineSchema],
});

module.exports = mongoose.model('Meeting', meetingSchema);