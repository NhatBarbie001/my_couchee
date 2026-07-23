const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const {LLMS_MODEL, API_KEY} = require('../../constants/dbCollections');
const {Schema} = require('mongoose');

const schema = new mongoose.Schema(
  {
    tokenUnit: {type: Number},
    unit: {type: String},
    gptModel: {type: String},
    maxTokens: {type: Number},
    priceInput: {type: Number},
    priceOutput: {type: Number},
    modelInterface: {type: String},
    isDefault: {type: Boolean, default: false},
    apiKeyId: {type: Schema.Types.ObjectId, ref: API_KEY},
    isDeleted: {type: Boolean, default: false},
  },
  {
    timestamps: {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    collation: {locale: 'vi'},
    versionKey: false,
  },
);

schema.plugin(mongoosePaginate);
module.exports = mongoose.model(LLMS_MODEL, schema, LLMS_MODEL);
