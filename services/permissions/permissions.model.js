const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {PERMISSIONS, USER, ORGANIZATION, SUBSCRIPTION} = require('../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema({

  userId: {type: mongoose.Schema.Types.ObjectId, ref: USER},
  organizationId: {type: mongoose.Schema.Types.ObjectId, ref: ORGANIZATION},
  subscriptionId: {type: mongoose.Schema.Types.ObjectId, ref: SUBSCRIPTION},
  accessRole: {type: Schema.Types.Mixed},
  accessLimit: {
    textLimit: String,
    mediaLimit: String,
    writingLimit: String,
    speakingLimit: String,
    capacityLimit: Number,
    textUsed: Number,
    mediaUsed: Number,
    writingUsed: Number,
    speakingUsed: Number,
    capacityUsed: Number,
    mediaDurationLimit: Number,
    textAddOnLimit: String,
    mediaAddOnLimit: String,
    speakingAddOnLimit: String,
    writingAddOnLimit: String,
  },
  type: {
    type: String,
    enum: ["personal", "organization"],
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
module.exports = mongoose.model(PERMISSIONS, schema, PERMISSIONS);

