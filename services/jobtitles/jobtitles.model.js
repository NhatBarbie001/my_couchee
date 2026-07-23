'use strict';

const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const { JOB_TITLE, USER } = require('../../constants/dbCollections');

const jobTitleSchema = new Schema(
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
      default: '',
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
jobTitleSchema.index({ name: 1, isDeleted: 1 }, { unique: true });

module.exports = mongoose.model(JOB_TITLE, jobTitleSchema, JOB_TITLE);
