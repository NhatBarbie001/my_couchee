'use strict';

const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const { ROLEPLAY_SKILL_GROUPS, USER } = require('../../../constants/dbCollections');

const skillGroupSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      maxlength: 255,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
    },
    enableStyleAnalysis: {
      type: Boolean,
      default: false,
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
skillGroupSchema.index({ name: 1, isDeleted: 1 }, { unique: true });

module.exports = mongoose.model(ROLEPLAY_SKILL_GROUPS, skillGroupSchema, ROLEPLAY_SKILL_GROUPS);
