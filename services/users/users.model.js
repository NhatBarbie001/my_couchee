const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const { ROLE, USER, IMAGE, ORGANIZATION, JOB_TITLE } = require('../../constants/dbCollections');
const { PERSONA } = require('../../constants/constant');
const { encryptPassword } = require("./users.helper");

const { Schema } = mongoose;
const userSchema = new Schema({
  username: {
    type: String,
    trim: true,
    unique: true,
    required: true,
    index: true,
    lowercase: true,
    minlength: 6,
    maxlength: 32
  },
  fullName: {
    type: String,
    trim: true,
    required: true,
    "default": ""
  },
  email: {
    type: String,
    trim: true,
    unique: true,
    index: true,
    lowercase: true
  },
  password: {
    type: String,
    required: "Please fill in a password"
  },
  gender: { type: String },
  phone: { type: String },
  avatar: { type: String },
  imageAvatarId: { type: Schema.Types.ObjectId, ref: IMAGE },
  organizationId: { type: Schema.Types.ObjectId, ref: ORGANIZATION },
  jobTitleId: { type: Schema.Types.ObjectId, ref: JOB_TITLE },
  isDeleted: { type: Boolean, default: false },
  roleId: [{ type: Schema.Types.ObjectId, ref: ROLE }],
  isSystemAdmin: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
  neverLogin: { type: Boolean, default: true },
  lastLogin: { type: Date },
  lastVisit: { type: Date },
  lastChangePassword: { type: Date, default: new Date() },
  deviceTokens: [],
  type: {
    type: [String],
    enum: ['admin', 'normal'],
    default: ['normal']
  },
  persona: [{
    type: String,
    enum: Object.values(PERSONA),
    default: "other"
  }],
  hearAboutUs: {
    type: Schema.Types.Mixed,
  },
  isDeveloper: { type: Boolean, default: false },
  moodleUserId: { type: Number, index: true },
  hasLocked: { type: Boolean, default: false },
  isShowAdmin: { type: Boolean, default: true },
  state: {
    type: String,
    enum: ["active", "waitlist"],
    default: "active"
  },
  hasPassword: { type: Boolean, default: true },
}, {
  timestamps: {
    createdAt: 'createdAt', updatedAt: 'updatedAt',
  }, collation: { locale: 'vi' }, versionKey: false,
});

userSchema.pre('save', function (next) {
  let user = this;
  // only hash the password if it has been modified (or is new)
  if (!user.isModified('password')) return next();
  user.password = encryptPassword(user.password);
  next();
});

userSchema.plugin(mongoosePaginate);

module.exports = mongoose.model(USER, userSchema, USER);
