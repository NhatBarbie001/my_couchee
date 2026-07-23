const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {SUBSCRIPTION, PACKAGE, CUSTOMER} = require('../../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema({

  customerId: {type: Schema.Types.ObjectId, required: true, ref: CUSTOMER},
  packageId: {type: Schema.Types.ObjectId, ref: PACKAGE},
  customerType: {
    type: String,
    enum: ['student', 'teacher', 'other']
  },
  startDate: {type: Date},
  endDate: {type: Date},
  isFree: {type: Boolean, default: false},
  isRecurring: {type: Boolean, default: false},
  isRenew: {type: Boolean, default: false},
  quantity: {type: Number},
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE', 'CANCELLED'],
  },
  packageType: {
    type: String,
    enum: ['base', 'addon'],
  },
  unitPrice: {
    type: String,
    enum: ['month', 'year']
  },
  intervalCount: {type: Number},
  autoRenew: {type: Boolean, default: false},

  isDeleted: {type: Boolean, default: false},

}, {
  timestamps: {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  versionKey: false,
});

schema.plugin(mongoosePaginate);
module.exports = mongoose.model(SUBSCRIPTION, schema, SUBSCRIPTION);

