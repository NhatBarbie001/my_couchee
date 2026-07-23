const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const { ROLEPLAY_COURSE_REMINDERS, USER, ROLEPLAY_COURSES } = require('../../../constants/dbCollections');

const courseReminderSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_COURSES,
      required: true,
      index: true,
    },
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
      // required: true,
    },
    message: {
      type: String,
      maxlength: 1000,
      trim: true,
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

courseReminderSchema.index({ userId: 1, courseId: 1 });

module.exports = mongoose.model(ROLEPLAY_COURSE_REMINDERS, courseReminderSchema, ROLEPLAY_COURSE_REMINDERS);
