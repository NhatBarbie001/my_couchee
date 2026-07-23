const mongoose = require('mongoose');
const {Schema} = require('mongoose');
const {AI_VOICE, API_KEY, FILE} = require('../../constants/dbCollections');
const mongoosePaginate = require('mongoose-paginate-v2');

const schema = new Schema(
  {
    displayName: {type: String, required: true},
    configName: {type: String, required: true},
    apiKeyId: {type: Schema.Types.ObjectId, ref: API_KEY, required: true},
    streaming: {type: Boolean, default: false},
    gender: {
      type: String,
      enum: ['male', 'female', 'neutral'],
      required: true,
    },
    languages: [
      {
        type: String,
        enum: ['vi', 'en', 'th', 'hi', 'zh', 'ko', 'ru', 'auto'],
      },
    ], // Ngôn ngữ hỗ trợ
    previewAudioId: {type: Schema.Types.ObjectId, ref: FILE},
    previewAudioUrl: {type: String},
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
module.exports = mongoose.model(AI_VOICE, schema, AI_VOICE);
