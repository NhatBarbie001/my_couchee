const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const { DISCOUNT_USAGE, DISCOUNT, CUSTOMER } = require('../../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema(
  {
    discountId: { type: Schema.Types.ObjectId, required: true, ref: DISCOUNT },
    customerId: { type: Schema.Types.ObjectId, required: true, ref: CUSTOMER },
    usedAt: { type: Date, default: Date.now },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    versionKey: false,
  },
);

// Create compound index to ensure one discount per user
schema.index({ discountId: 1, customerId: 1 }, { unique: true });

schema.plugin(mongoosePaginate);
module.exports = mongoose.model(DISCOUNT_USAGE, schema, DISCOUNT_USAGE);
