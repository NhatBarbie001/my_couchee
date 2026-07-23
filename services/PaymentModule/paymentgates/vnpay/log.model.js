'use strict';
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

let schema = new Schema(
  {
    url: { type: String, required: true },
    ip: { type: String },
    /**
     * 1: create payment
     * 2: ipn url
     */
    type: { type: Number, required: true },
    is_deleted: { type: Boolean, default: false },
    responseCode: { type: String },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    collection: 'vnplog',
  }
);

schema.virtual('params').get(function () {
  const urlParmas = new URLSearchParams(this.url.split('?')[1]);
  return Object.fromEntries(urlParmas.entries());
});

schema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    // remove these props when object is serialized
    delete ret._id;
    delete ret.id;
  },
});

module.exports = mongoose.model('VnpLog', schema);
