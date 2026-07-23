const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const { ORGANIZATION, USER, ORGANIZATION_USER } = require('../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema({

  userId: { type: Schema.Types.ObjectId, required: true, ref: USER },
  organizationId: { type: Schema.Types.ObjectId, required: true, ref: ORGANIZATION },
  isAdmin: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },

}, {
  timestamps: {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  versionKey: false,
});
schema.plugin(mongoosePaginate);
module.exports = mongoose.model(ORGANIZATION_USER, schema, ORGANIZATION_USER);

