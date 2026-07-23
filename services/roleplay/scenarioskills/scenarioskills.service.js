'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./scenarioskills.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;

module.exports = {
  name: 'scenarioskills',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService],

  settings: {
    entityValidator: {
      scenarioId: {type: 'string'},
      skillId: {type: 'string'},
      weight: {type: 'number', min: 0, max: 100},
    },
    populates: {
      scenarioId: 'aiscenarios.get',
      skillId: 'skills.get',
      createdBy: 'users.get',
      updatedBy: 'users.get',
    },
    populateOptions: ['skillId', 'createdBy', 'updatedBy'],
    fields: ['_id', 'scenarioId', 'skillId', 'weight', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'isDeleted'],
    defaultSort: 'weight',
  },

  hooks: {
    after: {
      create: async (ctx, scenarioSkill) => {
        ctx.emit('scenarioskills.created', {scenarioSkill});
        return scenarioSkill;
      },
      update: async (ctx, scenarioSkill) => {
        ctx.emit('scenarioskills.updated', {scenarioSkill});
        return scenarioSkill;
      },
      remove: async (ctx, scenarioSkill) => {
        ctx.emit('scenarioskills.deleted', {scenarioSkill});
        return scenarioSkill;
      },
    },
    before: {},
  },

  events: {
    'aiscenarios.deleted': {
      async handler(payload) {
        if (payload.scenario && payload.scenario._id) {
          const scenarioId = payload.scenario._id;
          try {
            await this.adapter.updateMany(
              {scenarioId, isDeleted: false},
              {$set: {isDeleted: true, deletedAt: new Date()}},
            );
            this.logger.info(`Deleted all scenario skills for scenario ${scenarioId}`);
          } catch (error) {
            this.logger.error(`Error deleting scenario skills for scenario ${scenarioId}:`, error);
          }
        }
      },
    },
  },

  actions: {
    configureSkillsForScenario: {
      rest: 'POST /scenario/:scenarioId/configure',
      params: {
        scenarioId: {type: 'string'},
        skills: {
          type: 'array',
          items: {
            type: 'object',
            props: {
              skillId: {type: 'string'},
              weight: {type: 'number', min: 0, max: 100},
            },
          },
        },
      },
      async handler(ctx) {
        const {scenarioId, skills} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const scenario = await ctx.call('aiscenarios.get', {id: scenarioId}).catch(() => null);
        if (!scenario) {
          throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'Kịch bản không tồn tại'), 404);
        }

        const totalWeight = skills.reduce((sum, s) => sum + s.weight, 0);
        if (totalWeight !== 100) {
          throw new MoleculerClientError(
            i18next.t('error.total_weight_must_be_100', 'Tổng trọng số của các kỹ năng phải bằng 100%'),
            400,
          );
        }

        // Validate tất cả skills tồn tại và active
        for (const skillConfig of skills) {
          const skill = await ctx.call('skills.get', {id: skillConfig.skillId}).catch(() => null);
          if (!skill) {
            throw new MoleculerClientError(i18next.t('error.skill_not_found', 'Tiêu chí đánh giá không tồn tại'), 404);
          }
          if (skill.status !== 'active') {
            throw new MoleculerClientError(
              i18next.t('error.skill_not_active', `Tiêu chí đánh giá ở trạng thái không hoạt động cần loại bỏ trước khi lưu`),
              400,
            );
          }
          // Không còn kiểm tra category - cho phép skills từ nhiều categories khác nhau
        }

        // Xóa mềm tất cả cấu hình skills cũ
        await this.adapter.updateMany(
          {scenarioId, isDeleted: false},
          {$set: {isDeleted: true, deletedAt: new Date(), updatedBy: user._id}},
        );

        // Tạo cấu hình skills mới
        const newConfigs = await Promise.all(
          skills.map(async skillConfig => {
            const data = {
              scenarioId,
              skillId: skillConfig.skillId,
              weight: skillConfig.weight,
              createdBy: user._id,
              updatedBy: user._id,
            };
            return this.adapter.insert(data);
          }),
        );

        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, newConfigs);
      },
    },

    getSkillsByScenario: {
      rest: 'GET /scenario/:scenarioId',
      params: {
        scenarioId: {type: 'string'},
      },
      async handler(ctx) {
        const {scenarioId} = ctx.params;

        const scenarioSkills = await this.adapter.find({
          query: {scenarioId, isDeleted: false},
          sort: '-weight',
        });

        return this.transformDocuments(ctx, {populate: ['skillId.skillGroupId']}, scenarioSkills);
      },
    },

    getScenariosBySkill: {
      rest: 'GET /skill/:skillId',
      params: {
        skillId: {type: 'string'},
        fields: {type: 'array', items: 'string', optional: true},
      },
      async handler(ctx) {
        const {skillId, fields} = ctx.params;
        const filterFields = fields || this.settings.fields;
        const scenarioSkills = await this.adapter.find({query: {skillId, isDeleted: false}});

        return await this.transformDocuments(
          ctx,
          {populate: ['scenarioId', 'createdBy', 'updatedBy'], fields: filterFields},
          scenarioSkills,
        );
      },
    },

    // Thêm một skill vào scenario
    addSkillToScenario: {
      rest: 'POST /scenario/:scenarioId/skill',
      params: {
        scenarioId: {type: 'string'},
        skillId: {type: 'string'},
        weight: {type: 'number', min: 0, max: 100},
      },
      async handler(ctx) {
        const {scenarioId, skillId, weight} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        // Kiểm tra đã tồn tại chưa
        const existing = await this.adapter.findOne({
          scenarioId,
          skillId,
          isDeleted: false,
        });

        if (existing) {
          throw new MoleculerClientError(
            i18next.t('error.scenario_skill_exists', 'Kỹ năng đã được thêm vào kịch bản này'),
            400,
          );
        }

        const data = {
          scenarioId,
          skillId,
          weight,
          createdBy: user._id,
          updatedBy: user._id,
        };

        const scenarioSkill = await this.adapter.insert(data);
        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, scenarioSkill);
      },
    },

    // Cập nhật trọng số của một skill trong scenario
    updateWeight: {
      rest: 'PUT /:id/weight',
      params: {
        id: {type: 'string'},
        weight: {type: 'number', min: 0, max: 100},
      },
      async handler(ctx) {
        const {id, weight} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const scenarioSkill = await this.adapter.findById(id);
        if (!scenarioSkill || scenarioSkill.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.scenario_skill_not_found', 'Cấu hình kỹ năng không tồn tại'),
            404,
          );
        }

        const updated = await this.adapter.updateById(id, {
          $set: {
            weight,
            updatedBy: user._id,
          },
        });

        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, updated);
      },
    },

    // Xóa một skill khỏi scenario
    removeSkillFromScenario: {
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

        const scenarioSkill = await this.adapter.findById(id);
        if (!scenarioSkill || scenarioSkill.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.scenario_skill_not_found', 'Cấu hình kỹ năng không tồn tại'),
            404,
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

    bulkSoftDeleteByScenarios: {
      visibility: 'public',
      params: {
        scenarioIds: {type: 'array', items: 'string'},
      },
      async handler(ctx) {
        const {scenarioIds} = ctx.params;
        if (!scenarioIds || scenarioIds.length === 0) return {modifiedCount: 0};

        const now = new Date();
        const result = await this.adapter.updateMany(
          {scenarioId: {$in: scenarioIds}, isDeleted: {$ne: true}},
          {$set: {isDeleted: true, deletedAt: now}},
        );
        const count = result.modifiedCount || result.nModified || 0;
        this.logger.info(`[bulkSoftDeleteByScenarios] Soft-deleted ${count} scenario skills`);
        return {modifiedCount: count};
      },
    },
  },

  methods: {},

  created() {},

  async started() {
    this.logger.info('ScenarioSkills service started');
  },

  async stopped() {
    this.logger.info('ScenarioSkills service stopped');
  },
};
