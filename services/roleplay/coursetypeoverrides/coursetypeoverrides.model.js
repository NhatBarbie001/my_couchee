const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {
  ROLEPLAY_COURSE_TYPE_OVERRIDES,
  ROLEPLAY_COURSES,
  USER,
  ORGANIZATION,
} = require('../../../constants/dbCollections');

const courseTypeOverrideSchema = new Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_COURSES,
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ['user', 'organization'],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    courseType: {
      type: String,
      enum: ['mandatory', 'optional'],
      required: true,
    },
    overrideBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
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

courseTypeOverrideSchema.index({courseId: 1, targetType: 1, targetId: 1}, {unique: true});

module.exports = mongoose.model(
  ROLEPLAY_COURSE_TYPE_OVERRIDES,
  courseTypeOverrideSchema,
  ROLEPLAY_COURSE_TYPE_OVERRIDES,
);
