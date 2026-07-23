const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {PROMOTIONS, PACKAGE} = require('../../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema({

  displayText: {type: String},
  description: {type: String},
  discount: {type: Number},

  type: {
    type: String,
    enum: ['fixed', 'percentage', 'bonus']
  },
  packageId: {type: Schema.Types.ObjectId, ref: PACKAGE},
  priceIndex: {type: Number, default: 0, min: 0},
  isActive: {type: Boolean, default: false},
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
module.exports = mongoose.model(PROMOTIONS, schema, PROMOTIONS);

