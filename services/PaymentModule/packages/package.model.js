const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {PACKAGE, FEATURE} = require('../../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema({

  name: {type: Schema.Types.Mixed},
  code: {type: String, unique: true},
  paidType: {
    type: String,
    enum: ['free', 'paid', 'business', 'sms'],
  },
  description: {type: String},
  featureIds: [{type: Schema.Types.ObjectId, ref: FEATURE}],
  prices: {type: Schema.Types.Mixed},
  order: {type: Number},
  type: {
    type: String,
    enum: ['base', 'addon'],
  },
  features: {type: Schema.Types.Mixed},
  customerTarget: {
    type: String,
    enum: ['student', 'teacher', 'other'],
  },
  isDeleted: {type: Boolean, default: false},

}, {
  timestamps: {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  versionKey: false,
});

schema.plugin(mongoosePaginate);
module.exports = mongoose.model(PACKAGE, schema, PACKAGE);

