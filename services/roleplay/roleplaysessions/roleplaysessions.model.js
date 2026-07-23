const mongoose = require("mongoose");
const { Schema } = require("mongoose");
const { ROLEPLAY_SESSIONS, FILE, USER, ROLEPLAY_COURSES, ROLEPLAY_SCENARIO_SKILLS, ROLEPLAY_AIPERSONAS, ROLEPLAY_ANALYSIS, ROLEPLAY_AI_SCENARIOS } = require("../../../constants/dbCollections");

const transcriptSchema = new Schema({
  role: {
    type: String,
    enum: ['student', 'ai'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  audioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: FILE
  },
  duration: { // Thời lượng của lượt nói này (tính bằng giây)
    type: Number
  },
  speakSpeed: { // Tốc độ nói (words/second)
    type: Number
  },
  // Đánh giá câu nói của học viên (chỉ áp dụng cho role = 'student')
  evaluation: {
    feedback: { // Nhận xét về câu nói
      type: String
    },
    suggestions: [{ // Đề xuất cải thiện
      type: String
    }],
    examples: [{ // Ví dụ cải thiện (nếu cần)
      type: String
    }],
    isCorrect: {
      type: Boolean,
      default: false
    },
    correctAnswer: {
      type: String
    },
    result: {
      type: String
    },
    type: {
      type: String,
      enum: ['soft_skill', 'knowledge'],
      default: 'soft_skill'
    }
  }
});

const schema = new Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
      required: true,
      index: true
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_COURSES,
      required: true
    },
    personaId: { // AI Persona được sử dụng cho phiên này
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_AIPERSONAS,
      required: true // Giả định mỗi session phải có persona
    },
    aiScenarioId: { // AI Scenario được sử dụng cho phiên này để thống kê
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_AI_SCENARIOS,
      index: true
    },
    moodleAssignmentId: {
      type: String,
      index: true
    },
    scenarioSkillIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_SCENARIO_SKILLS
    }],
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'analyzed'],
      default: 'pending'
    },
    startedAt: { type: Date },
    endTime: { type: Date },
    duration: { type: Number }, // Thời gian tương tác tính bằng giây
    recordingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: FILE
    },
    videoRecordingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: FILE
    },
    videoTurnMarkers: [{
      role: {
        type: String,
        enum: ['student', 'ai'],
        required: true
      },
      startTime: { // ms kể từ khi bắt đầu recording
        type: Number,
        required: true
      },
      endTime: { // ms kể từ khi bắt đầu recording
        type: Number,
        required: true
      }
    }],
    analysisId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_ANALYSIS
    },
    transcripts: [transcriptSchema],
    isCompleted: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
      required: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER
    },
  },
  {
    timestamps: {
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
    versionKey: false,
  }
);

// Composite indexes for common query patterns
schema.index({ studentId: 1, status: 1, createdAt: -1 });
schema.index({ courseId: 1, aiScenarioId: 1 });
schema.index({ isDeleted: 1, status: 1 });
schema.index({ isCompleted: 1, createdAt: -1 });
schema.index({ status: 1, analysisId: 1 });
schema.index({ studentId: 1, courseId: 1, status: 1, isDeleted: 1, analysisId: 1 });
schema.index({ courseId: 1, status: 1, isDeleted: 1, analysisId: 1 });

module.exports = mongoose.model(ROLEPLAY_SESSIONS, schema, ROLEPLAY_SESSIONS);
