const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {SETTING, TOOL, FILE} = require('../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema(
  {
    qdrantUrl: {type: String},
    qdrantApiKey: {type: String},
    qdrantCollectionName: {type: String},
    sttProvider: {type: String, enum: ['azure', 'elevenlabs'], default: 'azure'},
  },
  {
    timestamps: {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    versionKey: false,
  },
);
schema.plugin(mongoosePaginate);
module.exports = mongoose.model(SETTING, schema, SETTING);
