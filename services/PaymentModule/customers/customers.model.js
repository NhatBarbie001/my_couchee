const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {USER, CUSTOMER, ORGANIZATION} = require('../../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema({

  userId: {type: Schema.Types.ObjectId, ref: USER},
  organizationId: {type: Schema.Types.ObjectId, ref: ORGANIZATION},
  fullName: {type: String, trim: true,},
  phone: {type: String, trim: true,},
  email: {type: String, trim: true, lowercase: true},
  password: {type: String},

  isDeleted: {type: Boolean, default: false},

}, {
  timestamps: {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  versionKey: false,
});

schema.plugin(mongoosePaginate);
module.exports = mongoose.model(CUSTOMER, schema, CUSTOMER);

