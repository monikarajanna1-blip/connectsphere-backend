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

const participantSchema = new mongoose.Schema(
  {
    sid: String,
    role: String,
    joinedAt: Number,
    leftAt: Number,
    speakingMs: Number,
    micOnMs: Number,
    micToggles: Number,
    speechLines: Number,
    signLines: Number,
    words: Number,
  },
  { _id: false }
);

const meetingSchema = new mongoose.Schema({
  roomId: { type: String, index: true },
  hostId: { type: mongoose.Schema.Types.ObjectId },
  memberIds: { type: [mongoose.Schema.Types.ObjectId], index: true },
  startedAt: { type: Date, default: Date.now },
  endedAt: Date,
  lines: [lineSchema],
  participants: [participantSchema],
});

module.exports = mongoose.model('Meeting', meetingSchema);