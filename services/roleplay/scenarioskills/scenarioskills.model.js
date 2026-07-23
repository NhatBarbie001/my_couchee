const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {
  ROLEPLAY_SCENARIO_SKILLS,
  ROLEPLAY_AI_SCENARIOS,
  ROLEPLAY_SKILLS,
  USER,
} = require('../../../constants/dbCollections');

const scenarioSkillSchema = new Schema(
  {
    scenarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_AI_SCENARIOS,
      required: true,
      index: true,
    },
    skillId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_SKILLS,
      required: true,
      index: true,
    },
    weight: {
      // Trọng số tính bằng phần trăm (0-100)
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    versionKey: false,
  },
);

// Indexes
scenarioSkillSchema.index({scenarioId: 1, isDeleted: 1});
scenarioSkillSchema.index({skillId: 1, isDeleted: 1});

module.exports = mongoose.model(ROLEPLAY_SCENARIO_SKILLS, scenarioSkillSchema, ROLEPLAY_SCENARIO_SKILLS);
