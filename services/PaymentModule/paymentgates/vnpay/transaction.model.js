'use strict';
const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const {TRANSACTION} = require("../../../../constants/dbCollections");
let schema = new Schema(
  {
    date: {type: Date, required: true},
    amount: {type: Number, required: true},
    txnRef: {type: String, required: true},
    /**
     * 0: default
     * 1: payment success
     * 2: payment failed/error
     */
    status: {type: Number, required: true, default: 0},
    paymentLogId: {type: mongoose.Schema.Types.ObjectId, ref: 'VnpLog'},
    transactionId: {type: mongoose.Schema.Types.ObjectId, ref: TRANSACTION},
    is_deleted: {type: Boolean, default: false},
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    collection: 'vnptransaction',
  }
);
module.exports = mongoose.model('VnpTransaction', schema, 'VnpTransaction')
