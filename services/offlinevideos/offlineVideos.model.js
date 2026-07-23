const mongoose = require("mongoose");
const { Schema } = require("mongoose");
const { OFFLINE_VIDEOS, FILE } = require("../../constants/dbCollections");

const schema = new Schema(
  {
    name: { type: String, validate: /\S+/ },
    videoFileId: { type: Schema.Types.ObjectId, ref: FILE },
    transcripts: [
      {
        cutStart: { type: Number, default: 0 },
        cutEnd: { type: Number, default: 0 },
        text: { type: String, default: "" },
      },
    ],
    thumbnailFileId: { type: Schema.Types.ObjectId, ref: FILE },
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
module.exports = mongoose.model(OFFLINE_VIDEOS, schema, OFFLINE_VIDEOS);
