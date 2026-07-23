const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {API_KEY} = require('../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema(
  {
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    serviceType: {
      type: String,
      enum: ['llm', 'voice'],
    },
    apiKey: {type: String},
    modelInterface: {type: String},
    requestsPerDay: {type: Number},
    requestsPerMinute: {type: Number},
    endpoint: {type: String},

    serviceProvider: {type: String},
    serviceRegion: {type: String},
    url: {type: String},

    isDeleted: {type: Boolean, default: false},
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
module.exports = mongoose.model(API_KEY, schema, API_KEY);
