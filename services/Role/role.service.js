const DbMongoose = require('../../mixins/dbMongo.mixin');
const ROLE = require('./role.model');
const {Errors} = require('moleculer');
const BaseService = require('../../mixins/baseService.mixin');
const DefaultPermission = require('../../mixins/defaultPermission.mixin');
const {SERVICE_NAME} = require('./index');
const i18next = require('i18next');
const {validateRoleName, validatePermissions} = require('../../helpers/validationHelper');
const {RESOURCES, ACTIONS} = require('../../constants/permissions');

module.exports = {
  name: SERVICE_NAME,
  mixins: [DbMongoose(ROLE), BaseService, DefaultPermission],
  settings: {
    defaultResource: RESOURCES.ROLE,
    entityValidator: {
      name: {type: 'string', min: 1},
      code: {type: 'string', min: 1},
    },
    populates: {},
    populateOptions: [],
  },

  hooks: {
    after: {
      find(ctx, res) {
        return res;
      },
    },
  },

  actions: {
    remove: {
      rest: 'DELETE /:id',
      auth: 'required',
      permission: {resource: RESOURCES.ROLE, action: ACTIONS.DELETE},
      params: {
        id: 'string',
      },
      async handler(ctx) {
        const {id} = ctx.params;

        // Check if role is being used by any user
        const usersWithRole = await ctx.call('users.count', {
          query: {roleId: id, isDeleted: false},
        });

        if (usersWithRole > 0) {
          throw new Errors.MoleculerClientError(i18next.t('error_role_in_use'), 422);
        }

        const dataRes = await this.adapter.updateById(id, {isDeleted: true}, {new: true});
        this.broker.emit('roles.deleted', dataRes);

        return {
          success: true,
          message: i18next.t('role_deleted_successfully'),
          data: dataRes,
        };
      },
    },
    create: {
      rest: 'POST /',
      auth: 'required',
      permission: {resource: RESOURCES.ROLE, action: ACTIONS.CREATE},
      params: {
        name: {type: 'string', min: 1},
        code: {type: 'string', min: 1},
        description: {type: 'string', optional: true},
        permissions: {type: 'object', optional: true},
      },
      async handler(ctx) {
        const data = ctx.params;

        // Validate role name
        const nameValidation = validateRoleName(data.name);
        if (!nameValidation.valid) {
          throw new Errors.MoleculerClientError(i18next.t(nameValidation.error), 422);
        }

        // Check unique name
        const existingName = await this.adapter.findOne({
          name: data.name.trim(),
          isDeleted: false,
        });
        if (existingName) {
          throw new Errors.MoleculerClientError(i18next.t('error_role_name_exists'), 422);
        }

        // Check unique code
        const checkExistCode = await this.adapter.findOne({
          code: data.code,
          isDeleted: false,
        });
        if (checkExistCode) {
          throw new Errors.MoleculerClientError(i18next.t('role_code_already_exists'), 422);
        }

        // Validate permissions structure if provided
        if (data.permissions) {
          const permissionsValidation = validatePermissions(data.permissions);
          if (!permissionsValidation.valid) {
            throw new Errors.MoleculerClientError(i18next.t(permissionsValidation.error), 422);
          }
        }

        const role = await this.adapter.insert(data);

        return this.transformDocuments(ctx, {}, role);
      },
    },
    update: {
      rest: 'PUT /:id',
      auth: 'required',
      permission: {resource: RESOURCES.ROLE, action: ACTIONS.UPDATE},
      params: {
        id: {type: 'string', min: 1},
        name: {type: 'string', min: 1, optional: true},
        code: {type: 'string', min: 1, optional: true},
        description: {type: 'string', optional: true},
        permissions: {type: 'object', optional: true},
      },
      async handler(ctx) {
        const {id, ...data} = ctx.params;

        // Validate role name if provided
        if (data.name) {
          const nameValidation = validateRoleName(data.name);
          if (!nameValidation.valid) {
            throw new Errors.MoleculerClientError(i18next.t(nameValidation.error), 422);
          }

          // Check unique name
          const existingName = await this.adapter.findOne({
            name: data.name.trim(),
            isDeleted: false,
            _id: {$ne: id},
          });
          if (existingName) {
            throw new Errors.MoleculerClientError(i18next.t('error_role_name_exists'), 422);
          }
        }

        // Check unique code if provided
        if (data.code) {
          const checkExistCode = await this.adapter.findOne({code: data.code, isDeleted: false, _id: {$ne: id}});
          if (checkExistCode) {
            throw new Errors.MoleculerClientError(i18next.t('role_code_already_exists'), 422);
          }
        }

        // Validate permissions structure if provided
        if (data.permissions) {
          const permissionsValidation = validatePermissions(data.permissions);
          if (!permissionsValidation.valid) {
            throw new Errors.MoleculerClientError(i18next.t(permissionsValidation.error), 422);
          }
        }

        const updated = await this.adapter.updateById(id, data, {new: true});
        return this.transformDocuments(ctx, {}, updated);
      },
    },
    restore: {
      rest: 'POST /:id/restore',
      auth: 'required',
      permission: {resource: RESOURCES.ROLE, action: ACTIONS.RESTORE},
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;

        const role = await this.adapter.findById(id);
        if (!role) {
          throw new Errors.MoleculerClientError(i18next.t('error_role_not_found'), 404);
        }

        const restored = await this.adapter.updateById(id, {isDeleted: false}, {new: true});
        this.broker.emit('roles.restored', restored);

        return {
          success: true,
          message: i18next.t('role_restored_successfully'),
          data: restored,
        };
      },
    },
  },

  methods: {
    async seedDB() {
      this.logger.info('Seed Roles DB...');

      const defaultRoles = [
        {
          code: 'SYSTEM_ADMIN',
          name: 'Quản trị hệ thống',
          description: 'Có toàn quyền quản lý hệ thống',
          permissions: {
            organization: {view: true, create: true, update: true, delete: true, restore: true},
            user: {view: true, create: true, update: true, delete: true, restore: true},
            role: {view: true, create: true, update: true, delete: true, restore: true},
            course: {view: true, create: true, update: true, delete: true, restore: true},
            prompt: {view: true, create: true, update: true, delete: true, restore: true},
            report: {view: true, create: true, update: true, delete: true, restore: true},
            llmssettings: {view: true, create: true, update: true, delete: true, restore: true},
            category: {view: true, create: true, update: true, delete: true, restore: true},
          },
        },
        {
          code: 'ORG_ADMIN',
          name: 'Quản trị đơn vị',
          description: 'Quản lý người dùng và khóa học trong đơn vị',
          permissions: {
            organization: {view: true, create: false, update: true, delete: false, restore: false},
            user: {view: true, create: true, update: true, delete: true, restore: true},
            role: {view: true, create: false, update: false, delete: false, restore: false},
            course: {view: true, create: true, update: true, delete: true, restore: true},
            prompt: {view: true, create: true, update: true, delete: true, restore: true},
            report: {view: true, create: false, update: false, delete: false, restore: false},
            llmssettings: {view: true, create: false, update: false, delete: false, restore: false},
            category: {view: true, create: true, update: true, delete: true, restore: true},
          },
        },
        {
          code: 'TEACHER',
          name: 'Giáo viên',
          description: 'Tạo và quản lý khóa học, hướng dẫn',
          permissions: {
            organization: {view: false, create: false, update: false, delete: false, restore: false},
            user: {view: false, create: false, update: false, delete: false, restore: false},
            role: {view: false, create: false, update: false, delete: false, restore: false},
            course: {view: true, create: true, update: true, delete: true, restore: true},
            prompt: {view: true, create: true, update: true, delete: true, restore: true},
            report: {view: true, create: false, update: false, delete: false, restore: false},
            llmssettings: {view: true, create: false, update: false, delete: false, restore: false},
            category: {view: true, create: true, update: true, delete: true, restore: true},
          },
        },
        {
          code: 'STUDENT',
          name: 'Học viên',
          description: 'Xem và tham gia khóa học',
          permissions: {
            organization: {view: false, create: false, update: false, delete: false, restore: false},
            user: {view: false, create: false, update: false, delete: false, restore: false},
            role: {view: false, create: false, update: false, delete: false, restore: false},
            course: {view: true, create: false, update: false, delete: false, restore: false},
            prompt: {view: true, create: false, update: false, delete: false, restore: false},
            report: {view: true, create: false, update: false, delete: false, restore: false},
            llmssettings: {view: true, create: false, update: false, delete: false, restore: false},
            category: {view: true, create: false, update: false, delete: false, restore: false},
          },
        },
        {
          code: 'CONTRIBUTOR',
          name: 'Cộng tác viên',
          description: 'Đóng góp nội dung khóa học và hướng dẫn',
          permissions: {
            organization: {view: false, create: false, update: false, delete: false, restore: false},
            user: {view: false, create: false, update: false, delete: false, restore: false},
            role: {view: false, create: false, update: false, delete: false, restore: false},
            course: {view: true, create: true, update: true, delete: false, restore: false},
            prompt: {view: true, create: true, update: true, delete: false, restore: false},
            report: {view: true, create: false, update: false, delete: false, restore: false},
            llmssettings: {view: true, create: false, update: false, delete: false, restore: false},
            category: {view: true, create: true, update: true, delete: false, restore: false},
          },
        },
      ];

      for (const roleData of defaultRoles) {
        await this.adapter.insert(roleData);
        this.logger.info(`Created role: ${roleData.name} (${roleData.code})`);
      }

      this.logger.info(`Generated ${defaultRoles.length} default roles!`);
    },
  },

  async afterConnected() {
    const count = await this.adapter.count();
    if (count === 0) {
      return this.seedDB();
    }
  },
};
