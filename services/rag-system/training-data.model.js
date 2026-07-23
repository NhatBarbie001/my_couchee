'use strict';

const mongoose = require('mongoose');
const { TRAINING_DATA, USER, ORGANIZATION } = require('../../constants/dbCollections');
const { Schema } = mongoose;

const TrainingDataSchema = new Schema(
  {
    scenario: {
      name: { type: String, required: true },
      description: { type: String, default: '' },
      passScore: { type: Number, default: 70 },
      estimatedCallTimeInMinutes: { type: Number, default: 10 },
      aiSpeaksFirst: { type: Boolean, default: true },
      initialAiMessage: { type: String, default: '' },
    },
    persona: {
      name: { type: String, default: '' },
      age: { type: Number, default: null },
      gender: { type: String, enum: ['male', 'female'], default: 'male' },
      role: { type: String, default: 'Khách hàng' },
      mood: { type: String, default: '' },
      organization: { type: String, default: '' },
      smallTalkLikely: { type: Number, default: 30 },
      personaBackground: { type: String, default: '' },
      personaConcern: { type: String, default: '' },
    },
    data_label: {
      intent: { type: String, default: '' },
      product: { type: String, default: '' },
      sentiment: { type: String, default: '' },
      key_entity: [{ type: String }],
    },
    sample_conversation: [
      {
        role: { type: String, enum: ['user', 'assistant'] },
        content: { type: String },
      },
    ],
    qdrantId: { type: Number, default: null },
    indexed: { type: Boolean, default: false },
    indexedAt: { type: Date, default: null },
    source: { type: String, enum: ['user_input', 'file_upload', 'ai_generated'], default: 'user_input' },
    rawInput: { type: String, default: '' },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    createdBy: { type: Schema.Types.ObjectId, ref: USER },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'active' },
    collectionName: { type: String },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'training_data',
  },
);

TrainingDataSchema.index({ indexed: 1, status: 1 });
TrainingDataSchema.index({ organizationId: 1 });
TrainingDataSchema.index({ 'data_label.intent': 1 });
TrainingDataSchema.index({ 'data_label.product': 1 });

module.exports = mongoose.model(TRAINING_DATA, TrainingDataSchema, TRAINING_DATA);
