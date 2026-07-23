const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const { ROLEPLAY_AIPERSONAS, FILE, AI_VOICE, LLMS_MODEL, ROLEPLAY_INSTRUCTION } = require('../../../constants/dbCollections');

const schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      maxlength: 100,
    },
    age: {
      type: Number,
      min: 0,
      max: 100,
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
      trim: true,
    },
    avatarId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: FILE,
    },
    role: {
      type: String,
      maxlength: 100,
    },
    mood: {
      type: String,
      maxlength: 100,
    },
    organization: {
      type: String,
      maxlength: 255,
    },
    smallTalkLikely: {
      type: Number,
      default: 0,
    },
    filterWords: {
      type: [String],
      default: [],
    },
    personaBackground: {
      type: String,
      maxlength: 2000,
    },
    personaConcern: {
      type: String,
      maxlength: 2000,
    },
    voiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: AI_VOICE,
    },
    llmModelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: LLMS_MODEL,
    },
    conversationStyle: {
      type: String,
      maxlength: 2000,
    },
    voiceProvider: {
      type: String,
      maxlength: 500,
    },
    useGeminiLive: {
      type: Boolean,
      default: false,
    },
    personaPrompt: {
      type: String,
    },
    conversationEndCondition: {
      type: String,
      maxlength: 2000,
    },
    roleplayInstructionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_INSTRUCTION,
    },

    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
);
module.exports = mongoose.model(ROLEPLAY_AIPERSONAS, schema, ROLEPLAY_AIPERSONAS);
