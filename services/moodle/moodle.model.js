const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {MOODLE} = require('../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema(
  {
    baseUrl: {type: String, required: true},
    moodleToken: {type: String, required: true},
    status: {type: String, enum: ['active', 'inactive'], default: 'active'},
    isDeleted: {type: Boolean, default: false},
  },
  {
    timestamps: {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    versionKey: false,
  },
);

schema.plugin(mongoosePaginate);
module.exports = mongoose.model(MOODLE, schema, MOODLE);
