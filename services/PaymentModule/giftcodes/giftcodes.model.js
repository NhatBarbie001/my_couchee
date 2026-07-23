const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {GIFT_CODE, USER, SUBSCRIPTION, PACKAGE} = require('../../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema({

  giftCode: {type: String},
  subscriptionId: {type: Schema.Types.ObjectId, ref: SUBSCRIPTION},
  packageId: {type: Schema.Types.ObjectId, ref: PACKAGE},
  used: {type: Number, default: 0},
  limit: {type: Number},
  startDate: {type: Date},
  endDate: {type: Date},

  createdBy: {type: Schema.Types.ObjectId, ref: USER},

  isDeleted: {type: Boolean, default: false},

}, {
  timestamps: {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  versionKey: false,
});

schema.plugin(mongoosePaginate);
module.exports = mongoose.model(GIFT_CODE, schema, GIFT_CODE);

