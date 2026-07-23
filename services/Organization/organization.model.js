const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const { ORGANIZATION, FILE, USER, ORGANIZATION_TYPE } = require('../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema({
  name: {
    type: String,
    required: true,
    validate: /\S+/,
    maxlength: 100,
    trim: true
  },

  organizationTypeId: {
    type: Schema.Types.ObjectId,
    ref: ORGANIZATION_TYPE,
    required: true
  },

  parentOrganizationId: {
    type: Schema.Types.ObjectId,
    ref: ORGANIZATION,
    default: null
  },

  admin: {
    type: Schema.Types.ObjectId,
    ref: USER
  },

  avatarId: {
    type: Schema.Types.ObjectId,
    ref: FILE
  },

  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },

  active: {
    type: Boolean,
    default: true
  },
}, {
  timestamps: {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  versionKey: false,
});

schema.index({ parentOrganizationId: 1, isDeleted: 1 });
schema.index({ name: 1, parentOrganizationId: 1 });

schema.plugin(mongoosePaginate);

module.exports = mongoose.model(ORGANIZATION, schema, ORGANIZATION);
