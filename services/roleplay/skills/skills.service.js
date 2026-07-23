'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./skills.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const DefaultPermission = require('../../../mixins/defaultPermission.mixin');
const {RESOURCES, ACTIONS} = require('../../../constants/permissions');
const {ObjectId} = require('mongoose').Types;
module.exports = {
  name: 'skills',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService, DefaultPermission],

  settings: {
    defaultResource: RESOURCES.CATEGORY,
    entityValidator: {
      name: {type: 'string', min: 2, max: 255},
      instruction: {type: 'string', min: 10, max: 2000},
      status: {type: 'enum', values: ['active', 'inactive'], optional: true},
    },
    populates: {
      createdBy: 'users.get',
      updatedBy: 'users.get',
      organizationId: 'organizations.get',
      skillGroupId: 'skillgroups.get',
    },
    populateOptions: ['createdBy', 'updatedBy', 'organizationId', 'skillGroupId'],
    fields: [
      '_id',
      'name',
      'instruction',
      'status',
      'skillGroupId',
      'organizationId',
      'origin_skill_id',
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
      list: 'beforeListOrFind',
      find: 'beforeListOrFind',
    },
    after: {
      list: 'afterList',
      find: 'afterFind',
    },
  },

  actions: {
    getSkills: {
      rest: 'GET /getSkills',
      params: {
      },
      async handler(ctx) {
        return this.adapter.find({query: ctx.params});
      },
    },
    create: {
      rest: 'POST /',
      params: {
        name: {type: 'string', min: 2, max: 255},
        instruction: {type: 'string', min: 10, max: 2000},
        status: {type: 'enum', values: ['active', 'inactive'], optional: true},
        skillGroupId: {type: 'string', optional: true},
      },
      permission: {resource: RESOURCES.CATEGORY, action: ACTIONS.CREATE},
      async handler(ctx) {
        const {name, instruction, status, organizationId, skillGroupId} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }
        // // Kiểm tra user phải là admin của đơn vị
        // if (!user.isSystemAdmin && (!user.type || !user.type.includes('admin'))) {
        //   throw new MoleculerClientError(i18next.t('error.permission_denied', 'Bạn cần là admin để thêm kỹ năng'), 403);
        // }
        let finalOrganizationId;
        if (user.isSystemAdmin && organizationId) {
          finalOrganizationId = organizationId;
        } else {
          finalOrganizationId = user.organizationId;
        }

        // Kiểm tra trùng tên với các skill có thể thấy (đơn vị hiện tại + tổ tiên)
        const visibleOrgIds = await this.getOrganizationAncestors(ctx, finalOrganizationId);
        const existingSkill = await this.adapter.findOne({
          name: name.trim(),
          organizationId: {$in: visibleOrgIds},
          isDeleted: false,
        });

        if (existingSkill) {
          throw new MoleculerClientError(i18next.t('error.skill_name_exists', 'Tên kỹ năng đã tồn tại'), 400);
        }

        const skillData = {
          name: name.trim(),
          instruction: instruction.trim(),
          status: status || 'active',
          organizationId: finalOrganizationId,
          skillGroupId,
          createdBy: user._id,
          updatedBy: user._id,
        };

        const skill = await this.adapter.insert(skillData);
        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, skill);
      },
    },

    update: {
      rest: 'PUT /:id',
      params: {
        id: {type: 'string'},
        name: {type: 'string', min: 2, max: 255, optional: true},
        instruction: {type: 'string', min: 10, max: 2000, optional: true},
        status: {type: 'enum', values: ['active', 'inactive'], optional: true},
        skillGroupId: {type: 'string', optional: true},
      },
      permission: {resource: RESOURCES.CATEGORY, action: ACTIONS.UPDATE},
      async handler(ctx) {
        const {id, name, instruction, status, organizationId, skillGroupId} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const skill = await this.adapter.findById(id);
        if (!skill || skill.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.skill_not_found', 'Kỹ năng không tồn tại'), 404);
        }

        // Chỉ được xóa skill của chính đơn vị mình, không được xóa skill của đơn vị cha/ông
        if (!user.isSystemAdmin) {
          const userOrgId = user.organizationId?.toString();
          const skillOrgId = skill.organizationId?.toString();

          if (userOrgId !== skillOrgId) {
            throw new MoleculerClientError(
              i18next.t('error.permission_denied', 'Bạn không có quyền chỉnh sửa kỹ năng này'),
              403,
            );
          }
        }
        let finalOrganizationId = skill.organizationId;
        if (user.isSystemAdmin && organizationId) {
          // SystemAdmin có thể gửi organizationId và sử dụng nó
          finalOrganizationId = organizationId;
        }

        if (name && name.trim() !== skill.name) {
          // Kiểm tra trùng tên với các skill có thể thấy (đơn vị hiện tại + tổ tiên)
          const visibleOrgIds = await this.getOrganizationAncestors(ctx, finalOrganizationId);
          const existingSkill = await this.adapter.findOne({
            name: name.trim(),
            organizationId: {$in: visibleOrgIds},
            isDeleted: false,
            _id: {$ne: id},
          });

          if (existingSkill) {
            throw new MoleculerClientError(i18next.t('error.skill_name_exists', 'Tên kỹ năng đã tồn tại'), 400);
          }
        }

        const updateData = {
          updatedBy: user._id,
        };

        if (name) updateData.name = name.trim();
        if (instruction) updateData.instruction = instruction.trim();
        if (status) updateData.status = status;
        if (skillGroupId !== undefined) updateData.skillGroupId = skillGroupId;
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
      permission: {resource: RESOURCES.CATEGORY, action: ACTIONS.DELETE},
      async handler(ctx) {
        const {id} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const skill = await this.adapter.findById(id);
        if (!skill || skill.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.skill_not_found', 'Kỹ năng không tồn tại'), 404);
        }

        // Chỉ được xóa skill của chính đơn vị mình, không được xóa skill của đơn vị cha/ông
        if (!user.isSystemAdmin) {
          const userOrgId = user.organizationId?.toString();
          const skillOrgId = skill.organizationId?.toString();

          if (userOrgId !== skillOrgId) {
            throw new MoleculerClientError(
              i18next.t('error.permission_denied', 'Bạn chỉ được phép xóa kỹ năng của chính đơn vị mình'),
              403,
            );
          }
        }

        // Kiểm tra xem có user skill scores nào đang dùng skill này không
        const userSkillScores = await ctx.call('userskillscores.find', {
          query: {
            skillId: id,
            isDeleted: false,
          },
        });

        if (userSkillScores && userSkillScores.length > 0) {
          throw new MoleculerClientError(
            i18next.t('error.skill_in_user_scores', 'Không thể xóa kỹ năng vì đang được sử dụng bởi {{count}} bảng điểm người dùng', { count: userSkillScores.length }),
            400,
            'SKILL_IN_USE',
          );
        }

        const scenariosUsingSkill = await ctx.call('scenarioskills.getScenariosBySkill', {
          skillId: id,
        });

        if (scenariosUsingSkill && scenariosUsingSkill.length > 0) {
          const courseIds = scenariosUsingSkill
            .filter(ss => ss.scenarioId && ss.scenarioId.courseId)
            .map(ss => ss.scenarioId.courseId);

          if (courseIds.length > 0) {
            const publishedCourses = await ctx.call('courses.find', {
              query: {
                _id: {$in: courseIds},
                status: 'published',
                isDeleted: false,
              },
            });

            if (publishedCourses && publishedCourses.length > 0) {
              throw new MoleculerClientError(
                i18next.t(
                  'error.skill_in_active_course',
                  'Không thể xóa tiêu chí đang được sử dụng trong khóa học đang hoạt động. Vui lòng chuyển sang trạng thái "Ngưng sử dụng" thay vì xóa.',
                ),
                400,
              );
            }
          }
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

    // get: {
    //   rest: 'GET /:id',
    //   params: {
    //     id: {type: 'string'},
    //   },
    //   async handler(ctx) {
    //     const {id} = ctx.params;
    //     const user = ctx.meta.user;
    //
    //     if (!user) {
    //       throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
    //     }
    //
    //     const skill = await this.adapter.findById(id);
    //     if (!skill || skill.isDeleted) {
    //       throw new MoleculerClientError(i18next.t('error.skill_not_found', 'Kỹ năng không tồn tại'), 404);
    //     }
    //
    //     if (!user.isSystemAdmin) {
    //       const orgIds = await this.getOrganizationScope(ctx, user);
    //       const hasAccess = orgIds.some(orgId => orgId.toString() === skill.organizationId?.toString());
    //
    //       if (!hasAccess) {
    //         throw new MoleculerClientError(
    //           i18next.t('error.permission_denied', 'Bạn không có quyền xem kỹ năng này'),
    //           403,
    //         );
    //       }
    //     }
    //
    //     return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, skill);
    //   },
    // },

    getBySkillGroup: {
      rest: 'GET /skill-group/:skillGroupId',
      params: {
        skillGroupId: {type: 'string'},
      },
      async handler(ctx) {
        const {skillGroupId} = ctx.params;

        return ctx.call('skills.find', {
          query: {
            skillGroupId,
            status: 'active',
            isDeleted: false,
          },
          sort: 'name',
        });
      },
    },

    customize: {
      rest: 'POST /:id/customize',
      params: {
        id: {type: 'string'},
        instruction: {type: 'string', min: 10, max: 2000, optional: true},
      },
      permission: {resource: RESOURCES.CATEGORY, action: ACTIONS.CREATE},
      async handler(ctx) {
        const {id, instruction} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const originalSkill = await this.adapter.findById(id);
        if (!originalSkill || originalSkill.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.skill_not_found', 'Kỹ năng không tồn tại'), 404);
        }

        let userOrgId;
        if (user.isSystemAdmin && ctx.params.organizationId) {
          userOrgId = ctx.params.organizationId;
        } else {
          userOrgId = user.organizationId;
        }

        if (!userOrgId) {
          throw new MoleculerClientError(i18next.t('error.no_organization', 'Bạn không thuộc về đơn vị nào'), 400);
        }

        // Kiểm tra skill gốc có thuộc ancestor của user không
        const visibleOrgIds = await this.getOrganizationAncestors(ctx, userOrgId);
        const hasAccess = visibleOrgIds.some(orgId => orgId.toString() === originalSkill.organizationId?.toString());

        if (!hasAccess) {
          throw new MoleculerClientError(
            i18next.t('error.permission_denied', 'Bạn không có quyền tùy chỉnh kỹ năng này'),
            403,
          );
        }

        // Kiểm tra trùng tên với các skill có thể thấy (đơn vị hiện tại + tổ tiên)
        const existingSkill = await this.adapter.findOne({
          name: originalSkill.name,
          organizationId: {$in: visibleOrgIds},
          isDeleted: false,
        });

        if (existingSkill) {
          throw new MoleculerClientError(
            i18next.t('error.skill_name_exists', 'Kỹ năng với tên này đã tồn tại trong các đơn vị có thể truy cập'),
            400,
          );
        }

        // Tạo bản sao skill với origin_skill_id
        const customizedSkill = {
          name: originalSkill.name,
          instruction: instruction ? instruction.trim() : originalSkill.instruction,
          status: originalSkill.status,
          skillGroupId: originalSkill.skillGroupId,
          organizationId: userOrgId,
          origin_skill_id: originalSkill._id,
          createdBy: user._id,
          updatedBy: user._id,
        };

        const newSkill = await this.adapter.insert(customizedSkill);
        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, newSkill);
      },
    },
  },

  methods: {
    async beforeListOrFind(ctx) {
      const user = ctx.meta.user;
      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      ctx.meta.$$inheritanceUser = user;

      const orgIds = await this.getOrganizationAncestors(ctx, user.organizationId);
      ctx.meta.$$orgIds = orgIds;

      ctx.params.query = ctx.params.query || {};

      if (!user.isSystemAdmin) {
        ctx.params.query.organizationId = {$in: orgIds};
      }
    },

    async afterList(ctx, res) {
      const user = ctx.meta.$$inheritanceUser;
      if (!user || !res || !res.rows || !Array.isArray(res.rows)) {
        return res;
      }

      if (user.isSystemAdmin) {
        return res;
      }

      if (res.rows.length === 0) {
        return res;
      }

      try {
        const orgIds = ctx.meta.$$orgIds || [];
        const sortedOrgIds = [...orgIds].reverse().map(id => id.toString());
        const skillMap = new Map();

        // Process từ cha → con để con ghi đè cha cùng tên
        sortedOrgIds.forEach(orgId => {
          const skillsOfOrg = res.rows.filter(
            s => (s.organizationId?._id?.toString() || s.organizationId?.toString()) === orgId,
          );
          skillsOfOrg.forEach(skill => {
            skillMap.set(skill.name, skill);
          });
        });

        const uniqueSkills = Array.from(skillMap.values());

        return {
          ...res,
          rows: uniqueSkills,
        };
      } catch (error) {
        this.logger.error('Error in afterList hook:', error);
        return res;
      }
    },

    async afterFind(ctx, skills) {
      const user = ctx.meta.$$inheritanceUser;

      if (!user || !skills || !Array.isArray(skills)) {
        return skills;
      }

      if (user.isSystemAdmin) {
        return skills;
      }

      if (skills.length === 0) {
        return skills;
      }

      try {
        const orgIds = ctx.meta.$$orgIds || [];
        const sortedOrgIds = [...orgIds].reverse().map(id => id.toString());

        const skillMap = new Map();

        // Process từ cha → con để con ghi đè cha cùng tên
        sortedOrgIds.forEach(orgId => {
          const skillsOfOrg = skills.filter(
            s => (s.organizationId?._id?.toString() || s.organizationId?.toString()) === orgId,
          );
          skillsOfOrg.forEach(skill => {
            skillMap.set(skill.name, skill);
          });
        });

        return Array.from(skillMap.values());
      } catch (error) {
        this.logger.error('Error in afterFind hook:', error);
        return skills;
      }
    },

    async checkIsOrgAdmin(ctx, user) {
      if (user.isSystemAdmin) {
        return true;
      }

      if (!user.type || !user.type.includes('admin')) {
        return false;
      }

      return user.organizationId;
    },

    async checkSkillPermission(ctx, user, skill) {
      if (user.isSystemAdmin) {
        return true;
      }

      if (!user.type || !user.type.includes('admin')) {
        return false;
      }

      if (!skill.organizationId || !user.organizationId) {
        return false;
      }

      if (skill.organizationId.toString() !== user.organizationId.toString()) {
        return false;
      }

      return await this.checkIsOrgAdmin(ctx, user);
    },

    /**
     * Lấy danh sách ancestor organizations (từ con lên cha)
     * Dùng để xác định phạm vi kế thừa skills
     */
    async getOrganizationAncestors(ctx, organizationId) {
      if (!organizationId) {
        return [];
      }

      const orgIds = [new ObjectId(organizationId)];

      let currentOrg = await ctx.call('organizations.get', {
        id: organizationId.toString(),
      });

      // Lấy tất cả các tổ chức cha/ông
      while (currentOrg && currentOrg.parentOrganizationId) {
        orgIds.push(new ObjectId(currentOrg.parentOrganizationId));
        currentOrg = await ctx.call('organizations.get', {
          id: currentOrg.parentOrganizationId.toString(),
        });
      }

      return orgIds;
    },
  },

  created() {},

  async started() {
    this.logger.info('Skills service started');
  },

  async stopped() {
    this.logger.info('Skills service stopped');
  },
};
