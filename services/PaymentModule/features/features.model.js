const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {FEATURE} = require('../../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema({
  name: {type: Schema.Types.Mixed},
  code: {type: String},
  type: {
    type: String,
    enum: ['String', 'Number', 'Boolean']
  },
  packageType: {
    type: String,
    enum: ['base', 'addon'],
  },
  value: {type: Schema.Types.Mixed},
  unit: {type: String},
  description: {type: String},
  canDelete: {type: Boolean, default: false},
  localization: {
    name: {
      en: {type: String, validate: /\S+/},
      vi: {type: String, validate: /\S+/},
    },
    description: {
      en: {type: String, validate: /\S+/},
      vi: {type: String, validate: /\S+/},
    }
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
module.exports = mongoose.model(FEATURE, schema, FEATURE);

