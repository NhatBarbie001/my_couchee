'use strict';

const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const { ROLEPLAY_COURSE_CATEGORIES, USER } = require('../../../constants/dbCollections');

const courseCategorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      maxlength: 255,
      trim: true,
    },
    description: {
      type: String,
      maxlength: 1000,
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
courseCategorySchema.index({ name: 1, isDeleted: 1 }, { unique: true });

module.exports = mongoose.model(ROLEPLAY_COURSE_CATEGORIES, courseCategorySchema, ROLEPLAY_COURSE_CATEGORIES);
