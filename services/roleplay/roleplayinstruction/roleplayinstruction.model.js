const mongoose = require("mongoose");
const {Schema} = require("mongoose");
const {ROLEPLAY_INSTRUCTION, USER, ORGANIZATION, ROLEPLAY_SCENARIO_CATEGORIES} = require("../../../constants/dbCollections");

const RoleplayInstructionSchema = new Schema({
    personaInstruction: {type: String},
    topicInstruction: {type: String},
    conversationInstruction: {type: String},
    analyzeInstruction: {type: String},
    name: {type: String, required: true},
    scenarioCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ROLEPLAY_SCENARIO_CATEGORIES,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ORGANIZATION,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: USER,
    },
    isDeleted : {type: Boolean, default: false, index: true},
}, {
    timestamps: true,
    collection: ROLEPLAY_INSTRUCTION,
});

const RoleplayInstructionModel = mongoose.model(ROLEPLAY_INSTRUCTION, RoleplayInstructionSchema);
module.exports = RoleplayInstructionModel;
