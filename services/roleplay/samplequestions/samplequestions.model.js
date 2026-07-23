'use strict';

const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const { ROLEPLAY_SAMPLE_QUESTIONS, USER } = require('../../../constants/dbCollections');

const sampleQuestionSchema = new Schema(
  {
    content: {
      type: String,
      required: true,
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
sampleQuestionSchema.index({ content: 1, isDeleted: 1 });

module.exports = mongoose.model(ROLEPLAY_SAMPLE_QUESTIONS, sampleQuestionSchema, ROLEPLAY_SAMPLE_QUESTIONS);
