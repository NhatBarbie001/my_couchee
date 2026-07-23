const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {ORGANIZATION_TYPE} = require('../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    parentIds: [{
      type: Schema.Types.ObjectId,
      ref: ORGANIZATION_TYPE,
      index: true,
    }],
    isRoot: {
      type: Boolean,
      default: false,
    },
    level: {
      type: Number,
      default: 0,
      min: 0,
      max: 10,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    versionKey: false,
  },
);

schema.index({order: 1});

schema.plugin(mongoosePaginate);

module.exports = mongoose.model(ORGANIZATION_TYPE, schema, ORGANIZATION_TYPE);
