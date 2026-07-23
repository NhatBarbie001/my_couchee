const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {DISCOUNT} = require('../../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema({

  code: {type: String, required: true, unique: true},
  discount: {type: Number},
  numOfUsed: {type: Number, default: 0},
  numOfUses: {type: Number, default: 0},
  limit: {type: Number},
  type: {
    type: String,
    enum: ['fixed', 'percentage']
  },
  isActivate: {type: Boolean, default: false},
  startDate: {type: Date},
  endDate: {type: Date},

  isDeleted: {type: Boolean, default: false},

}, {
  timestamps: {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  versionKey: false,
});

schema.plugin(mongoosePaginate);
module.exports = mongoose.model(DISCOUNT, schema, DISCOUNT);

