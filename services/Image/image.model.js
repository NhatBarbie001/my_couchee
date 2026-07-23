const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const { INSPECTION, FILE, IMAGE, USER } = require('../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema({
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: USER,
    required: true,
  },
  name: { type: String, required: true, validate: /\S+/ },
  imageFileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: FILE,
    required: true,
  },
  thumbnailFileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: FILE,
  },
  text: { type: String },
  lat: { type: String },
  lng: { type: String },
  width: { type: Number },
  height: { type: Number },
  description: { type: String },
  isDeleted: { type: Boolean, default: false },
}, {
  timestamps: {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  versionKey: false,
});
schema.plugin(mongoosePaginate);
module.exports = mongoose.model(IMAGE, schema, IMAGE);

