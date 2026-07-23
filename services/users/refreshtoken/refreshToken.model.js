const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const { USER } = require('../../../constants/dbCollections');
const { REFRESH_TOKEN } = require('../../../constants/dbCollections');

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: USER },
  refreshToken: { type: String, required: true },
  expiresDate: { type: Date, required: true },
  isDeleted: { type: Boolean, default: false, select: false },
}, {
  timestamps: {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  collation: { locale: 'vi' },
  versionKey: false,
});

schema.plugin(mongoosePaginate);
module.exports = mongoose.model(REFRESH_TOKEN, schema, REFRESH_TOKEN);
