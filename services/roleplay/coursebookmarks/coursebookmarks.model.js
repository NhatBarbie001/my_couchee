const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {ROLEPLAY_COURSE_BOOKMARKS, USER, ROLEPLAY_COURSES} = require('../../../constants/dbCollections');

const courseBookmarkSchema = new Schema(
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
  },
  {
    timestamps: {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    versionKey: false,
  },
);

courseBookmarkSchema.index({userId: 1, courseId: 1}, {unique: true});

module.exports = mongoose.model(ROLEPLAY_COURSE_BOOKMARKS, courseBookmarkSchema, ROLEPLAY_COURSE_BOOKMARKS);
