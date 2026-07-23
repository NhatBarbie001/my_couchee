'use strict';

const Model = require('./roleplayinstruction.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const DefaultPermission = require('../../../mixins/defaultPermission.mixin');
const {RESOURCES, ACTIONS} = require('../../../constants/permissions');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const {ObjectId} = require('mongoose').Types;

module.exports = {
  name: 'roleplayinstruction',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService, DefaultPermission],

  settings: {
    defaultResource: RESOURCES.PROMPT,
    entityValidator: {
      personaInstruction: {type: 'string', optional: true},
      topicInstruction: {type: 'string', optional: true},
      conversationInstruction: {type: 'string', optional: true},
      analyzeInstruction: {type: 'string', optional: true},
      name: {type: 'string', min: 2, max: 255},
      scenarioCategoryId: {type: 'string', optional: true},
    },
    populates: {
      scenarioCategoryId: 'scenariocategories.get',
      createdBy: 'users.get',
      updatedBy: 'users.get',
      organizationId: 'organizations.get',
    },
    populateOptions: ['scenarioCategoryId', 'createdBy', 'updatedBy', 'organizationId'],
    fields: [
      '_id',
      'personaInstruction',
      'topicInstruction',
      'conversationInstruction',
      'analyzeInstruction',
      'name',
      'scenarioCategoryId',
      'organizationId',
      'createdBy',
      'updatedBy',
      'createdAt',
      'updatedAt',
      'isDeleted',
    ],
    defaultSort: '-createdAt',
  },

  hooks: {
    before: {
      list: 'applyOrganizationFilter',
      find: 'applyOrganizationFilter',
    },
    after: {},
  },

  actions: {
    create: {
      rest: 'POST /',
      params: {
        personaInstruction: {type: 'string', optional: true},
        topicInstruction: {type: 'string', optional: true},
        conversationInstruction: {type: 'string', optional: true},
        analyzeInstruction: {type: 'string', optional: true},
        name: {type: 'string', min: 2, max: 255},
        scenarioCategoryId: {type: 'string', optional: true},
        organizationId: {type: 'string', optional: true}, // Optional, only for systemAdmin
      },
      permission: {resource: RESOURCES.PROMPT, action: ACTIONS.CREATE},
      async handler(ctx) {
        const {
          personaInstruction,
          topicInstruction,
          conversationInstruction,
          analyzeInstruction,
          name,
          scenarioCategoryId,
          organizationId,
        } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        // Xác định organizationId dựa trên loại tài khoản
        let finalOrganizationId;
        if (user.isSystemAdmin && organizationId) {
          // SystemAdmin có thể gửi organizationId và sử dụng nó
          finalOrganizationId = organizationId;
        } else {
          // Admin sử dụng organizationId của user
          finalOrganizationId = user.organizationId;
        }

        // Kiểm tra tên đã tồn tại trong đơn vị chưa
        const existingInstruction = await this.adapter.findOne({
          name: name.trim(),
          organizationId: finalOrganizationId,
          isDeleted: false,
        });

        if (existingInstruction) {
          throw new MoleculerClientError(
            i18next.t('error.instruction_name_exists', 'Tên hướng dẫn đã tồn tại trong đơn vị'),
            400,
          );
        }

        const instructionData = {
          personaInstruction: personaInstruction || '',
          topicInstruction: topicInstruction || '',
          conversationInstruction: conversationInstruction || '',
          analyzeInstruction: analyzeInstruction || '',
          name: name.trim(),
          scenarioCategoryId: scenarioCategoryId || null,
          organizationId: finalOrganizationId,
          createdBy: user._id,
          updatedBy: user._id,
        };

        const instruction = await this.adapter.insert(instructionData);
        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, instruction);
      },
    },

    update: {
      rest: 'PUT /:id',
      params: {
        id: {type: 'string'},
        personaInstruction: {type: 'string', optional: true},
        topicInstruction: {type: 'string', optional: true},
        conversationInstruction: {type: 'string', optional: true},
        analyzeInstruction: {type: 'string', optional: true},
        name: {type: 'string', min: 2, max: 255, optional: true},
        scenarioCategoryId: {type: 'string', optional: true},
        organizationId: {type: 'string', optional: true}, // Optional, only for systemAdmin
      },
      permission: {resource: RESOURCES.PROMPT, action: ACTIONS.UPDATE},
      async handler(ctx) {
        const {
          id,
          personaInstruction,
          topicInstruction,
          conversationInstruction,
          analyzeInstruction,
          name,
          scenarioCategoryId,
          organizationId,
        } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const instruction = await this.adapter.findById(id);
        if (!instruction || instruction.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.instruction_not_found', 'Hướng dẫn không tồn tại'), 404);
        }

        let finalOrganizationId = instruction.organizationId;
        if (user.isSystemAdmin && organizationId) {
          // SystemAdmin có thể gửi organizationId và sử dụng nó
          finalOrganizationId = organizationId;
        }

        if (name && name.trim() !== instruction.name) {
          const existingInstruction = await this.adapter.findOne({
            name: name.trim(),
            organizationId: finalOrganizationId,
            isDeleted: false,
            _id: {$ne: id},
          });

          if (existingInstruction) {
            throw new MoleculerClientError(
              i18next.t('error.instruction_name_exists', 'Tên hướng dẫn đã tồn tại trong đơn vị'),
              400,
            );
          }
        }

        const updateData = {
          updatedBy: user._id,
        };


        if (personaInstruction !== undefined) updateData.personaInstruction = personaInstruction;
        if (topicInstruction !== undefined) updateData.topicInstruction = topicInstruction;
        if (conversationInstruction !== undefined) updateData.conversationInstruction = conversationInstruction;
        if (analyzeInstruction !== undefined) updateData.analyzeInstruction = analyzeInstruction;
        if (name) updateData.name = name.trim();
        if (scenarioCategoryId !== undefined) updateData.scenarioCategoryId = scenarioCategoryId || null;
        if (user.isSystemAdmin && organizationId) updateData.organizationId = organizationId;

        const updated = await this.adapter.updateById(id, {$set: updateData});
        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, updated);
      },
    },

    remove: {
      rest: 'DELETE /:id',
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const instruction = await this.adapter.findById(id);
        if (!instruction || instruction.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.instruction_not_found', 'Hướng dẫn không tồn tại'), 404);
        }

        // Kiểm tra xem có aipersonas nào đang dùng instruction này không
        const personas = await ctx.call('aipersonas.find', {
          query: {
            roleplayInstructionId: id,
            isDeleted: false,
          },
        });

        if (personas && personas.length > 0) {
          throw new MoleculerClientError(
            i18next.t('error.instruction_in_use', 'Không thể xóa hướng dẫn vì đang được sử dụng bởi {{count}} AI Persona', { count: personas.length }),
            400,
            'INSTRUCTION_IN_USE',
          );
        }

        const updated = await this.adapter.updateById(id, {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            updatedBy: user._id,
          },
        });

        return this.transformDocuments(ctx, {}, updated);
      },
    },



    getByOrganization: {
      rest: 'GET /organization/:organizationId',
      params: {
        organizationId: {type: 'string'},
        roleplayInstructionId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {organizationId, roleplayInstructionId} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const descendants = await ctx.call('organizations.getAllDescendants', {
          orgId: organizationId,
        });

        const orgIds = [organizationId];
        if (descendants && descendants.length > 0) {
          orgIds.push(...descendants.map(desc => desc._id));
        }

        const query = {
          isDeleted: false,
          $or: [{organizationId: {$in: orgIds}}],
        };

        if (roleplayInstructionId) {
          query.$or.push({_id: roleplayInstructionId});
        }

        const instructions = await this.adapter.find({
          query,
          sort: 'name',
        });

        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, instructions);
      },
    },
  },

  methods: {
    async applyOrganizationFilter(ctx) {
      const user = ctx.meta.user;

      if (!user) {
        return;
      }

      const orgIds = await this.getOrganizationScope(ctx, user);

      ctx.params.query = ctx.params.query || {};

      if (!user.isSystemAdmin) {
        ctx.params.query.organizationId = {$in: orgIds};
      }
    },

    async checkIsTopLevelOrgAdmin(ctx, user) {
      if (user.isSystemAdmin) {
        return true;
      }

      if (!user.type || !user.type.includes('admin')) {
        return false;
      }

      if (!user.organizationId) {
        return false;
      }

      const organization = await ctx.call('organizations.get', {
        id: user.organizationId.toString(),
      });

      if (!organization) {
        return false;
      }

      return !organization.parentOrganizationId;
    },

    async checkInstructionPermission(ctx, user, instruction) {
      if (user.isSystemAdmin) {
        return true;
      }

      if (!user.type || !user.type.includes('admin')) {
        return false;
      }

      if (!instruction.organizationId || !user.organizationId) {
        return false;
      }

      if (instruction.organizationId.toString() !== user.organizationId.toString()) {
        return false;
      }

      return await this.checkIsTopLevelOrgAdmin(ctx, user);
    },

    async getOrganizationScope(ctx, user) {
      if (user.isSystemAdmin) {
        const allOrgs = await ctx.call('organizations.find', {
          query: {isDeleted: false},
          fields: ['_id'],
        });
        return allOrgs.map(org => org._id);
      }

      if (!user.organizationId) {
        return [];
      }

      const orgIds = [new ObjectId(user.organizationId)];

      let currentOrg = await ctx.call('organizations.get', {
        id: user.organizationId.toString(),
      });

      while (currentOrg && currentOrg.parentOrganizationId) {
        orgIds.push(new ObjectId(currentOrg.parentOrganizationId));
        currentOrg = await ctx.call('organizations.get', {
          id: currentOrg.parentOrganizationId.toString(),
        });
      }

      const descendants = await ctx.call('organizations.getAllDescendants', {
        orgId: user.organizationId.toString(),
      });

      if (descendants && descendants.length > 0) {
        orgIds.push(...descendants.map(desc => desc._id));
      }

      return orgIds;
    },
  },

  started() {
    this.logger.info('RoleplayInstructionService started');
  },

  stopped() {
    this.logger.info('RoleplayInstructionService stopped');
  },
};
