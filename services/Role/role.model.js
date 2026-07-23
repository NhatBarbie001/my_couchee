const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const { ROLE } = require('../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String },
  permissions: {
    type: Schema.Types.Mixed,
    default: {
      organization: { view: false, create: false, update: false, delete: false },
      user: { view: false, create: false, update: false, delete: false },
      role: { view: false, create: false, update: false, delete: false },
      course: { view: false, create: false, update: false, delete: false },
      prompt: { view: false, create: false, update: false, delete: false },
      report: { view: false, create: false, update: false, delete: false }
    }
  },
  isDeleted: { type: Boolean, default: false, select: false },
}, {
  timestamps: {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  versionKey: false,
});
schema.plugin(mongoosePaginate);
module.exports = mongoose.model(ROLE, schema, ROLE);

