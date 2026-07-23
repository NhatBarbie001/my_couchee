const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {ROLEPLAY_USER_SKILL_SCORES, USER, ORGANIZATION, ROLEPLAY_SKILLS} = require('../../../constants/dbCollections');

const userSkillScoreSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
      required: true,
      index: true,
    },
    skillId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_SKILLS,
      required: true,
      index: true,
    },
    skillName: {
      type: String,
      required: true,
      maxlength: 255,
      trim: true,
    },
    category: {
      type: String,
      enum: ['skill', 'knowledge'],
    },
    averageScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 0,
    },
    totalScore: {
      type: Number,
      required: true,
      default: 0,
    },
    sessionCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    lastScore: {
      type: Number,
      min: 0,
      max: 100,
    },
    lastSessionDate: {
      type: Date,
    },
    highestScore: {
      type: Number,
      min: 0,
      max: 100,
    },
    lowestScore: {
      type: Number,
      min: 0,
      max: 100,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ORGANIZATION,
      index: true,
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

userSkillScoreSchema.index({userId: 1, skillId: 1}, {unique: true});
userSkillScoreSchema.index({userId: 1, organizationId: 1});
userSkillScoreSchema.index({organizationId: 1, category: 1});
userSkillScoreSchema.index({averageScore: -1});
userSkillScoreSchema.index({sessionCount: -1});

module.exports = mongoose.model(ROLEPLAY_USER_SKILL_SCORES, userSkillScoreSchema, ROLEPLAY_USER_SKILL_SCORES);
