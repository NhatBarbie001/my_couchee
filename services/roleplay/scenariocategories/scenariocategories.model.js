'use strict';

const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const { ROLEPLAY_SCENARIO_CATEGORIES, ROLEPLAY_SAMPLE_QUESTIONS, USER } = require('../../../constants/dbCollections');

const scenarioCategorySchema = new Schema(
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
    trainingDescription: {
      type: String,
      default: null,
    },
    sampleQuestions: [
      {
        sampleQuestionId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: ROLEPLAY_SAMPLE_QUESTIONS,
          default: null,
        },
        customQuestion: {
          type: String,
          default: null,
          trim: true,
        },
        isRequired: {
          type: Boolean,
          default: false,
        },
      },
    ],
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
scenarioCategorySchema.index({ name: 1, isDeleted: 1 }, { unique: true });

module.exports = mongoose.model(ROLEPLAY_SCENARIO_CATEGORIES, scenarioCategorySchema, ROLEPLAY_SCENARIO_CATEGORIES);
