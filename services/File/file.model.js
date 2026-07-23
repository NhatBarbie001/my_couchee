const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {FILE, USER} = require('../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema({
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: USER,
    required: true,
  },
  name: {type: String, required: true, validate: /\S+/},
  displayName: {type: String, validate: /\S+/},
  fileType: {type: String, required: true, validate: /\S+/},
  mimetype: {type: String},
  size: {type: String},
  storageType: {type: String},
  storageLocation: {type: String},
  texts: [
    {
      firstPage: {type: Number, default: 1},
      lastPage: {type: Number, default: 1},
      text: {type: String, default: ""},
    },
  ],
  isDeleted: {type: Boolean, default: false},
  used: {type: Boolean},
  videoTranscript: {
    rawTranscript: {type: String},
    processedTranscript: {type: String},
    duration: {type: Number},
    chunks: {type: Number},
    extractedAt: {type: Date},
  },
}, {
  timestamps: {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  versionKey: false,
});
schema.plugin(mongoosePaginate);
module.exports = mongoose.model(FILE, schema, FILE);

