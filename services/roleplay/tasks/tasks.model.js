const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const { ROLEPLAY_AI_SCENARIOS, ROLEPLAY_TASKS } = require("../../../constants/dbCollections");

const taskSchema = new Schema(
  {
    name: { // Tên của nhiệm vụ
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    description: { // Mô tả chi tiết cho nhiệm vụ (từ PRD: "Mô tả riêng")
      type: String,
      trim: true,
      maxlength: 5000, // Tăng giới hạn cho mô tả chi tiết
    },
    evaluationGuidelines: { // Hướng dẫn đánh giá chi tiết cho nhiệm vụ
      type: String,
      trim: true,
      maxlength: 5000,
      default: ""
    },
    weight: { // Trọng số của nhiệm vụ trong tổng thể khóa học/phần học
      type: Number,
      min: 0, // Trọng số không thể âm
      // max: 100, // Có thể đặt max nếu tính theo thang điểm 100
      default: 0
    },
    exampleVideoUrl: { // URL đến video mẫu minh họa cách thực hiện nhiệm vụ
      type: String,
      trim: true,
      default: ""
      // Validate URL if needed using a custom validator or a library like 'validator'
    },
    helpfulLinks: [{ // Mảng các URL đến tài liệu/link tham khảo hữu ích
      type: String,
      trim: true,
      // Validate URL if needed
    }],
    isMakeOrBreak: { // Đánh dấu nhiệm vụ này có tính chất "sống còn" / "quyết định"
      type: Boolean,
      default: false,
    },
    orderInScenario: { // Thứ tự của nhiệm vụ trong một scenario
        type: Number,
        default: 0,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: {
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
    // Tên collection sẽ được truyền vào mongoose.model()
    // collection: ROLEPLAY_TASKS_COLLECTION_NAME // Có thể chỉ định ở đây hoặc trong model export
  }
);

// Indexes
taskSchema.index({ orderInScenario: 1 }); // Để truy vấn nhiệm vụ theo thứ tự

module.exports = mongoose.model(ROLEPLAY_TASKS, taskSchema, ROLEPLAY_TASKS);
