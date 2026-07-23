
const mongoose = require("mongoose");
const { Schema } = require("mongoose");
const { VIDEO } = require("../../constants/dbCollections");

const schema = new Schema(
  {
    title: { type: String, required: true, validate: /\S+/ },
    displayName: { type: String, validate: /\S+/ },
    url: { type: String, required: true, validate: /\S+/ },
    videoId: { type: String, required: true, validate: /\S+/ },
    audioFilePath: { type: String, validate: /\S+/ },
    lengthSeconds: { type: Number, default: 0 },
    thumbnails: [
      {
        url: { type: String, required: true, validate: /\S+/ },
        width: { type: Number, default: 0 },
        height: { type: Number, default: 0 },
      },
    ],
    transcripts: [
      {
        cutStart: { type: Number, default: 0 },
        cutEnd: { type: Number, default: 0 },
        text: { type: String, default: "" },
      },
    ],
    embed: {
      iframeUrl: String,
      width: Number,
      height: Number,
    },
    thumbnailBase64: { type: String },
  },
  {
    timestamps: {
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
    versionKey: false,
  },
);
module.exports = mongoose.model(VIDEO, schema, VIDEO);
