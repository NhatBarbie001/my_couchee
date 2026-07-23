const mongoose = require("mongoose");
const { Schema } = require("mongoose");
const { ROLEPLAY_REFERENCES, FILE, USER, ORGANIZATION, VIDEO, IMAGE, AUDIO, OFFLINE_VIDEOS } = require("../../../constants/dbCollections");
const mongoosePaginate = require('mongoose-paginate-v2');

const referenceSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: FILE,
    },
    videoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: VIDEO,
    },
    offlineVideoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: OFFLINE_VIDEOS,
    },
    imageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: IMAGE,
    },
    audioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: AUDIO,
    },
    url: {
      type: String,
      trim: true,
    },
    content: {
      type: String,
      trim: true,
    },
    text: {
      type: String,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ORGANIZATION,
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
    aiReadable: {
      type: Boolean,
      default: false,
    },
    aiSummary: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'completed',
      index: true,
    },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: {
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
    versionKey: false,
  },
);

// Indexes
referenceSchema.index({ name: 1, organizationId: 1 });
referenceSchema.index({ type: 1 });
referenceSchema.index({ videoId: 1 });
referenceSchema.index({ imageId: 1 });
referenceSchema.index({ audioId: 1 });
referenceSchema.index({ offlineVideoId: 1 });
referenceSchema.index({ fileId: 1 });
referenceSchema.index({ createdBy: 1 });

referenceSchema.plugin(mongoosePaginate);

module.exports = mongoose.model(ROLEPLAY_REFERENCES, referenceSchema, ROLEPLAY_REFERENCES);
