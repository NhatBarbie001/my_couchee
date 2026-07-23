const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const {
  ROLEPLAY_AI_SCENARIOS,
  ROLEPLAY_COURSES,
  ROLEPLAY_AIPERSONAS,
  ROLEPLAY_TASKS,
  ROLEPLAY_REFERENCES,
  ROLEPLAY_SCENARIO_CATEGORIES,
  ROLEPLAY_SKILL_GROUPS,
  USER,
  ORGANIZATION,
} = require('../../../constants/dbCollections');

const aiScenarioSchema = new Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_COURSES,
      required: true,
      index: true,
    },
    aiPersonaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_AIPERSONAS,
      required: false,
    },
    scenarioCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_SCENARIO_CATEGORIES,
    },
    skillGroupIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: ROLEPLAY_SKILL_GROUPS,
      },
    ],
    name: {
      type: String,
      required: true,
      maxlength: 255,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    studentDescription: {
      // Mô tả dành cho học viên — hiển thị với học viên trước khi thực hành
      type: String,
      trim: true,
    },
    aiDescription: {
      // Mô tả dành cho AI Coach — truyền cho AI để hiểu ngữ cảnh kịch bản
      type: String,
      trim: true,
    },
    moodleAssignmentId: {
      type: Number,
      index: true,
    },
    estimatedCallTimeInMinutes: {
      // Thời gian cuộc gọi ước tính cho kịch bản này (tính bằng phút)
      type: Number,
      min: 0,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ORGANIZATION,
      index: true,
    },
    passScore: {
      // Điểm số đạt yêu cầu để hoàn thành kịch bản
      type: Number,
      min: 0,
      max: 100,
    },
    simulationFormat: {
      type: String,
      enum: ['dialogue', 'knowledge_test'],
      default: 'dialogue',
    },
    aiSpeaksFirst: {
      type: Boolean,
      default: false,
    },
    initialAiMessage: {
      type: String,
      maxlength: 1000,
      trim: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    enableStyleAnalysis: {
      type: Boolean,
      default: false,
    },
    order: {
      type: Number,
    },
    // STT Normalization Hints — từ khoá chuyên ngành giúp engine STT nhận diện chính xác hơn
    sttKeywordHints: [{ type: String, trim: true }],
    // Bảng ánh xạ: key là dạng ASR hay nhận sai, value là từ đúng cần thay thế
    sttMappingHints: { type: Map, of: String },

    references: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: ROLEPLAY_REFERENCES,
      },
    ],
  },
  {
    timestamps: {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    versionKey: false,
  },
);

// Indexes
aiScenarioSchema.index({ courseId: 1, status: 1 });
aiScenarioSchema.index({ name: 1, organizationId: 1 });
aiScenarioSchema.index({ aiPersonaId: 1 });

module.exports = mongoose.model(ROLEPLAY_AI_SCENARIOS, aiScenarioSchema, ROLEPLAY_AI_SCENARIOS);
