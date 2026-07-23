'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const FileMixin = require('../../../mixins/file.mixin');
const Model = require('./courses.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const DefaultPermission = require('../../../mixins/defaultPermission.mixin');
const {RESOURCES} = require('../../../constants/permissions');
const {getConfig} = require('../../../config/config');

const coreActions = require('./courses.actions');
const adminActions = require('./courses.actions.admin');
const moodleActions = require('./courses.actions.moodle');
const publishActions = require('./courses.actions.publish');
const emailActions = require('./courses.actions.email');

const hooks = require('./courses.hooks');
const events = require('./courses.events');
const methods = require('./courses.methods');

module.exports = {
  name: 'courses',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService, FileMixin, DefaultPermission],

  settings: {
    config: getConfig(process.env.NODE_ENV),
    defaultResource: RESOURCES.COURSE,
    entityValidator: {
      description: {type: 'string', optional: true, max: 5000},
      introduction: {type: 'string', optional: true, max: 5000},
      referenceUrls: {type: 'array', optional: true, items: 'string'},
      referenceFiles: {type: 'array', optional: true, items: 'string'},
      courseType: {type: 'enum', values: ['mandatory', 'optional'], optional: true},
      courseCategoryId: {type: 'string', optional: true},
      deadline: {type: 'date', optional: true, convert: true},
      startDate: {type: 'date', optional: true, convert: true},
      isSequentialStudyRequired: {type: 'boolean', optional: true},
      isActive: {type: 'boolean', optional: true},
      thumbnailIds: {type: 'array', items: 'string', optional: true, max: 5},
      publishedToUsers: {
        type: 'array',
        optional: true,
        items: {
          type: 'object',
          props: {
            userId: {type: 'string'},
            courseType: {type: 'enum', values: ['mandatory', 'optional'], optional: true},
          },
        },
      },
    },
    populates: {
      references: 'references.get',
      courseCategoryId: 'coursecategories.get',
      organizationId: 'organizations.get',
      createdBy: 'users.get',
      updatedBy: 'users.get',
      'publishedToUsers.userId': 'users.get',
      'references.fileId': 'files.get',
    },
    populateOptions: [
      'references',
      'references.fileId',
      'references.createdBy',
      'courseCategoryId',
      'organizationId',
      'createdBy',
      'updatedBy',
      'publishedToUsers.userId',
      'publishedToUsers.userId.jobTitleId',
    ],
    fields: [
      '_id',
      'name',
      'description',
      'introduction',
      'thumbnailId',
      'thumbnailIds',
      'references',
      'courseType',
      'courseCategoryId',
      'deadline',
      'startDate',
      'organizationId',
      'publishedToUsers',
      'createdBy',
      'updatedBy',
      'createdAt',
      'updatedAt',
      'status',
      'isActive',
      'isDeleted',
      'totalEstimatedCallTimeInMinutes',
      'userCompletionPercentage',
      'moodleCourseId',
      'expired_status',
      'isSequentialStudyRequired',
      'lastReminderSentAt',
    ],
  },

  hooks,

  dependencies: ['files', 'organizations', 'users', 'references'],

  actions: {
    ...coreActions,
    ...adminActions,
    ...moodleActions,
    ...publishActions,
    ...emailActions,
  },

  events,

  methods,

  async started() {
    try {
      await this.migrateCourseTypes();
      console.log('Course service started');
    } catch (err) {
      this.logger.error('Migration failed:', err);
    }
  },
};
