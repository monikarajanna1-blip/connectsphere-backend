const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
  },
  resetToken: {
    type: String,
  },
  resetTokenExpiry: {
    type: Date,
  },
  // Accessibility preferences, saved per account
  accessibility: {
    liveCaptions: { type: Boolean, default: false },
    speakSigns: { type: Boolean, default: true },
    autoSign: { type: Boolean, default: false },
    highContrast: { type: Boolean, default: false },
    captionSize: {
      type: String,
      enum: ['small', 'medium', 'large'],
      default: 'medium',
    },
  },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);