const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {ROLEPLAY_SKILLS, USER, ORGANIZATION, ROLEPLAY_SKILL_GROUPS} = require('../../../constants/dbCollections');

const skillSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      maxlength: 255,
      trim: true,
    },
    skillGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_SKILL_GROUPS,
    },
    instruction: {
      type: String,
      required: true,
      maxlength: 2000,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ORGANIZATION,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
    },
    origin_skill_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_SKILLS,
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

// Indexes
// Unique constraint: name must be unique within each organization
skillSchema.index({name: 1, organizationId: 1, isDeleted: 1}, {unique: true});
skillSchema.index({skillGroupId: 1, status: 1});
skillSchema.index({organizationId: 1, isDeleted: 1});

module.exports = mongoose.model(ROLEPLAY_SKILLS, skillSchema, ROLEPLAY_SKILLS);
