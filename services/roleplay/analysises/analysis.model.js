"use strict";

const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { ROLEPLAY_SKILLS } = require("../../../constants/dbCollections");

// Sub-schema for individual skill analysis
const SkillAnalysisSchema = new Schema({
  skillId: {
    type: Schema.Types.ObjectId,
    ref: ROLEPLAY_SKILLS,
    required: true
  },
  skillName: { type: String },
  score: { type: Number },
  weight: { type: Number }, // Trọng số của skill (0-100)
  details: { type: String },
  strengths: [{ type: String }], // Điểm mạnh
  weaknesses: [{ type: String }], // Điểm yếu
  suggestions: [{ type: String }] // Gợi ý cải thiện
}, {_id: false});

// Schema for analysis results
const AnalysisSchema = new Schema(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "RolePlaySession",
      required: true,
      index: true
    },
    // Kết quả phân tích chi tiết
    result: {
      summary: { type: String, required: true },
      topInsights: [{ type: String }],
      simulationScore: { type: Number },
      knowledgeAnalysis: {
        score: { type: Number }, // Điểm tổng knowledge (tính từ skills)
        proficiencyProcess: { type: String }, // Overall proficiency
        skillAnalyses: [SkillAnalysisSchema] // Array of analyses for each skill
      },
      styleAnalysis: {
        score: { type: Number },
        clarity: { type: String, enum: ['low', 'medium', 'high'] },
        pace: {
          wordsPerMinute: { type: Number },
          evaluation: { type: String }
        },
        fillerWords: {
          count: { type: Number },
          evaluation: { type: String }
        },
        sentenceLength: {
          average: { type: Number },
          evaluation: { type: String }
        },
        energy: { type: String, enum: ['low', 'medium', 'high'] }
      },
      trainerFeedback: {
        generalComments: { type: String },
        improvementSuggestions: [{ type: String }]
      },
      // Các phân tích bổ sung
      emotionAnalysis: { type: Schema.Types.Mixed },
      videoAnalysis: { type: Schema.Types.Mixed },
      softSkillsAnalysis: { type: Schema.Types.Mixed },
      managerFeedback: { type: Schema.Types.Mixed }
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    collection: "RolePlayAnalysis"
  }
);

// Ensure indexes for frequent queries
AnalysisSchema.index({ sessionId: 1, isDeleted: 1 });
AnalysisSchema.index({ createdAt: -1 });

module.exports = mongoose.model("RolePlayAnalysis", AnalysisSchema);
