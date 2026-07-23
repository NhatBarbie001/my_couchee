const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {
  ROLEPLAY_COURSES,
  FILE,
  USER,
  ROLEPLAY_REFERENCES,
  ORGANIZATION,
  ROLEPLAY_COURSE_CATEGORIES,
} = require('../../../constants/dbCollections');

const courseSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      maxlength: 255,
      trim: true,
    },
    description: {
      type: String,
      maxlength: 5000,
      trim: true,
    },
    courseCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_COURSE_CATEGORIES,
    },
    courseType: {
      type: String,
      enum: ['mandatory', 'optional', 'both'],
      default: 'optional',
    },
    startDate: {
      type: Date,
    },
    deadline: {
      type: Date,
    },
    lastReminderSentAt: {
      type: Date,
    },
    isSequentialStudyRequired: {
      type: Boolean,
      default: false,
    },
    expired_status: {
      type: String,
      enum: ['pending', 'due_soon', 'overdue'],
      default: 'pending',
    },
    introduction: {
      type: String,
      maxlength: 5000,
      trim: true,
    },
    moodleCourseId: {
      type: Number,
    },

    references: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: ROLEPLAY_REFERENCES,
      },
    ],

    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ORGANIZATION,
      index: true,
    },
    publishedToUsers: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: USER,
        },
        courseType: {
          type: String,
          enum: ['mandatory', 'optional'],
          default: 'optional',
        },
        _id: false,
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
    },
    isDeleted: {type: Boolean, default: false, index: true},
    isActive: {type: Boolean, default: true, index: true},
    status: {
      type: String,
      enum: ['draft', 'published', 'archived', 'completed'],
      default: 'draft',
      index: true,
    },
    thumbnailId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: FILE,
    },
    thumbnailIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: FILE,
        },
      ],
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
courseSchema.index({name: 1, organizationId: 1});
courseSchema.index({'publishedToUsers.userId': 1});
courseSchema.index({status: 1});

module.exports = mongoose.model(ROLEPLAY_COURSES, courseSchema, ROLEPLAY_COURSES);
