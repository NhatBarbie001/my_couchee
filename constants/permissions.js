exports.RESOURCES = {
  ORGANIZATION: 'organization',
  USER: 'user',
  ROLE: 'role',
  COURSE: 'course',
  PROMPT: 'prompt',
  REPORT: 'report',
  LLMS_SETTINGS: 'llmssettings',
  CATEGORY: 'category'
};

exports.ACTIONS = {
  VIEW: 'view',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  RESTORE: 'restore'
};

exports.DEFAULT_PERMISSIONS = {
  SYSTEM_ADMIN: {
    organization: { view: true, create: true, update: true, delete: true, restore: true },
    user: { view: true, create: true, update: true, delete: true, restore: true },
    role: { view: true, create: true, update: true, delete: true, restore: true },
    course: { view: true, create: true, update: true, delete: true, restore: true },
    prompt: { view: true, create: true, update: true, delete: true, restore: true },
    report: { view: true, create: true, update: true, delete: true, restore: true },
    llmssettings: { view: true, create: true, update: true, delete: true, restore: true },
  },
  ORG_ADMIN: {
    organization: { view: true, create: false, update: true, delete: false, restore: false },
    user: { view: true, create: true, update: true, delete: true, restore: true },
    role: { view: true, create: false, update: false, delete: false, restore: false },
    course: { view: true, create: true, update: true, delete: true, restore: true },
    prompt: { view: true, create: true, update: true, delete: true, restore: true },
    report: { view: true, create: false, update: false, delete: false, restore: false },
    llmssettings: { view: true, create: false, update: false, delete: false, restore: false },
  },
  NORMAL: {
    organization: { view: false, create: false, update: false, delete: false, restore: false },
    user: { view: false, create: false, update: false, delete: false, restore: false },
    role: { view: false, create: false, update: false, delete: false, restore: false },
    course: { view: true, create: false, update: false, delete: false, restore: false },
    prompt: { view: true, create: false, update: false, delete: false, restore: false },
    report: { view: true, create: false, update: false, delete: false, restore: false },
    llmssettings: { view: true, create: false, update: false, delete: false, restore: false },
  }
};
