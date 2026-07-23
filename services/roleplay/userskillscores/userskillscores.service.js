'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./userskillscores.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const DefaultPermission = require('../../../mixins/defaultPermission.mixin');
const {RESOURCES, ACTIONS} = require('../../../constants/permissions');
const mongoose = require('mongoose');

module.exports = {
  name: 'userskillscores',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService, DefaultPermission],

  settings: {
    defaultResource: RESOURCES.CATEGORY,
    populates: {
      userId: 'users.get',
      skillId: 'skills.get',
      organizationId: 'organizations.get',
    },
    populateOptions: ['userId', 'skillId', 'organizationId'],
    fields: [
      '_id',
      'userId',
      'skillId',
      'skillName',
      'category',
      'averageScore',
      'totalScore',
      'sessionCount',
      'lastScore',
      'lastSessionDate',
      'highestScore',
      'lowestScore',
      'organizationId',
      'createdAt',
      'updatedAt',
      'isDeleted',
    ],
    defaultSort: '-updatedAt',
  },

  hooks: {
    before: {
      list: 'beforeListOrFind',
      find: 'beforeListOrFind',
    },
  },

  actions: {
    updateSkillScore: {
      rest: 'POST /update',
      params: {
        userId: {type: 'string'},
        skillId: {type: 'string'},
        skillName: {type: 'string'},
        category: {type: 'enum', values: ['skill', 'knowledge'], optional: true},
        score: {type: 'number', min: 0, max: 100},
        organizationId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {userId, skillId, skillName, category, score, organizationId} = ctx.params;

        const existingRecord = await this.adapter.findOne({
          userId,
          skillId,
          isDeleted: false,
        });

        if (existingRecord) {
          const newSessionCount = existingRecord.sessionCount + 1;
          const newTotalScore = existingRecord.totalScore + score;
          const newAverageScore = Math.round(newTotalScore / newSessionCount);

          const updateData = {
            totalScore: newTotalScore,
            sessionCount: newSessionCount,
            averageScore: newAverageScore,
            lastScore: score,
            lastSessionDate: new Date(),
            highestScore: Math.max(existingRecord.highestScore || score, score),
            lowestScore: Math.min(
              existingRecord.lowestScore !== undefined && existingRecord.lowestScore !== null
                ? existingRecord.lowestScore
                : score,
              score,
            ),
          };

          const updated = await this.adapter.updateById(existingRecord._id, {$set: updateData});
          return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, updated);
        } else {
          const newRecord = {
            userId,
            skillId,
            skillName,
            category,
            averageScore: score,
            totalScore: score,
            sessionCount: 1,
            lastScore: score,
            lastSessionDate: new Date(),
            highestScore: score,
            lowestScore: score,
            organizationId: organizationId || null,
          };

          const created = await this.adapter.insert(newRecord);
          return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, created);
        }
      },
    },

    batchUpdateSkillScores: {
      rest: 'POST /batch-update',
      params: {
        userId: {type: 'string'},
        organizationId: {type: 'string', optional: true},
        skills: {
          type: 'array',
          items: {
            type: 'object',
            props: {
              skillId: {type: 'string'},
              skillName: {type: 'string'},
              category: {type: 'enum', values: ['skill', 'knowledge'], optional: true},
              score: {type: 'number', min: 0, max: 100},
            },
          },
        },
      },
      async handler(ctx) {
        const {userId, organizationId, skills} = ctx.params;
        const results = [];

        for (const skill of skills) {
          const result = await ctx.call('userskillscores.updateSkillScore', {
            userId,
            skillId: skill.skillId,
            skillName: skill.skillName,
            category: skill.category,
            score: skill.score,
            organizationId,
          });
          results.push(result);
        }

        return results;
      },
    },

    getUserSkillScores: {
      rest: 'GET /user/:userId',
      params: {
        userId: {type: 'string'},
        category: {type: 'enum', values: ['skill', 'knowledge'], optional: true},
      },
      async handler(ctx) {
        const {userId, category} = ctx.params;
        const query = {
          userId,
          isDeleted: false,
        };

        if (category) {
          query.category = category;
        }

        return ctx.call('userskillscores.find', {
          query,
          sort: '-averageScore',
        });
      },
    },

    getUserSkillScoresBySkillGroup: {
      rest: 'GET /user/:userId/skill-group/:skillGroupId',
      params: {
        userId: {type: 'string'},
        skillGroupId: {type: 'string'},
      },
      async handler(ctx) {
        const {userId, skillGroupId} = ctx.params;

        // Lookup skills by skillGroupId
        const skills = await ctx.call('skills.getSkills', {
          skillGroupId: skillGroupId,
          isDeleted: {$ne: true},
        });
        const skillIds = skills.map(s => s._id.toString());

        if (skillIds.length === 0) return [];

        return ctx.call('userskillscores.find', {
          query: {
            userId,
            skillId: {$in: skillIds},
            isDeleted: false,
          },
          sort: '-averageScore',
        });
      },
    },

    getSkillStatistics: {
      rest: 'GET /statistics/skill/:skillId',
      params: {
        skillId: {type: 'string'},
        organizationId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {skillId, organizationId} = ctx.params;
        const query = {
          skillId,
          isDeleted: false,
        };

        if (organizationId) {
          query.organizationId = organizationId;
        }

        const records = await this.adapter.find({query});

        if (!records || records.length === 0) {
          return {
            skillId,
            totalUsers: 0,
            averageScore: 0,
            highestScore: 0,
            lowestScore: 0,
            totalSessions: 0,
          };
        }

        const totalUsers = records.length;
        const averageScore = Math.round(records.reduce((sum, r) => sum + r.averageScore, 0) / totalUsers);
        const highestScore = Math.max(...records.map(r => r.highestScore || 0));
        const lowestScore = Math.min(...records.map(r => r.lowestScore || 100));
        const totalSessions = records.reduce((sum, r) => sum + r.sessionCount, 0);

        return {
          skillId,
          totalUsers,
          averageScore,
          highestScore,
          lowestScore,
          totalSessions,
        };
      },
    },

    getUserProgress: {
      rest: 'GET /progress/user/:userId',
      params: {
        userId: {type: 'string'},
      },
      async handler(ctx) {
        const {userId} = ctx.params;

        const records = await this.adapter.find({
          query: {
            userId,
            isDeleted: false,
          },
          sort: '-lastSessionDate',
        });

        const skillRecords = records.filter(r => r.category === 'skill');
        const knowledgeRecords = records.filter(r => r.category === 'knowledge');

        return {
          userId,
          summary: {
            totalSkills: skillRecords.length,
            totalKnowledge: knowledgeRecords.length,
            totalSessions: records.reduce((sum, r) => sum + r.sessionCount, 0),
            averageSkillScore:
              skillRecords.length > 0
                ? Math.round(skillRecords.reduce((sum, r) => sum + r.averageScore, 0) / skillRecords.length)
                : 0,
            averageKnowledgeScore:
              knowledgeRecords.length > 0
                ? Math.round(knowledgeRecords.reduce((sum, r) => sum + r.averageScore, 0) / knowledgeRecords.length)
                : 0,
          },
          skills: skillRecords,
          knowledge: knowledgeRecords,
        };
      },
    },

    getTopPerformers: {
      rest: 'GET /top-performers',
      params: {
        category: {type: 'enum', values: ['skill', 'knowledge'], optional: true},
        organizationId: {type: 'string', optional: true},
        limit: {type: 'number', optional: true, default: 10, min: 1, max: 100},
      },
      async handler(ctx) {
        const {category, organizationId, limit} = ctx.params;
        const query = {
          isDeleted: false,
        };

        if (category) {
          query.category = category;
        }
        if (organizationId) {
          query.organizationId = organizationId;
        }

        return ctx.call('userskillscores.find', {
          query,
          sort: '-averageScore',
          limit,
        });
      },
    },

    getTopUsersByScore: {
      rest: 'GET /top-users',
      params: {
        category: {type: 'enum', values: ['skill', 'knowledge'], optional: true},
        organizationId: {type: 'string', optional: true},
        skillId: {type: 'string', optional: true},
        limit: {type: 'number', optional: true, default: 100, min: 1, max: 1000},
      },
      async handler(ctx) {
        const {category, organizationId, skillId, limit} = ctx.params;
        const user = ctx.meta.user;

        const matchQuery = {
          isDeleted: false,
        };

        if (category) {
          matchQuery.category = category;
        }

        if (skillId) {
          matchQuery.skillId = new mongoose.Types.ObjectId(skillId);
        }

        let targetOrgId = organizationId;
        if (!targetOrgId && user && user.organizationId) {
          targetOrgId = user.organizationId.toString();
        }

        if (targetOrgId) {
          try {
            const descendants = await ctx.call('organizations.getAllDescendants', {
              orgId: targetOrgId,
            });

            const orgIds = [new mongoose.Types.ObjectId(targetOrgId)];
            descendants.forEach(desc => {
              orgIds.push(desc._id);
            });

            matchQuery.organizationId = {$in: orgIds};
          } catch (error) {
            this.logger.warn(`Could not get descendants for org ${targetOrgId}: ${error.message}`);
            matchQuery.organizationId = new mongoose.Types.ObjectId(targetOrgId);
          }
        }

        const pipeline = [
          {$match: matchQuery},
          {
            $group: {
              _id: '$userId',
              overallAverageScore: {$avg: '$averageScore'},
              totalSessionCount: {$sum: '$sessionCount'},
              skillCount: {$sum: 1},
              highestScore: {$max: '$highestScore'},
              lowestScore: {$min: '$lowestScore'},
              lastSessionDate: {$max: '$lastSessionDate'},
            },
          },
          {$sort: {overallAverageScore: -1}},
          {$limit: limit},
        ];

        const results = await this.adapter.model.aggregate(pipeline);

        const enrichedResults = await Promise.all(
          results.map(async (result, index) => {
            try {
              const userInfo = await ctx.call('users.get', {id: result._id.toString()});
              return {
                rank: index + 1,
                userId: result._id.toString(),
                userInfo,
                overallAverageScore: Math.round(result.overallAverageScore * 100) / 100,
                totalSessionCount: result.totalSessionCount,
                skillCount: result.skillCount,
                highestScore: result.highestScore,
                lowestScore: result.lowestScore,
                lastSessionDate: result.lastSessionDate,
              };
            } catch (error) {
              this.logger.warn(`Could not fetch user info for ${result._id}: ${error.message}`);
              return {
                rank: index + 1,
                userId: result._id.toString(),
                userInfo: null,
                overallAverageScore: Math.round(result.overallAverageScore * 100) / 100,
                totalSessionCount: result.totalSessionCount,
                skillCount: result.skillCount,
                highestScore: result.highestScore,
                lowestScore: result.lowestScore,
                lastSessionDate: result.lastSessionDate,
              };
            }
          }),
        );

        return enrichedResults;
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

        const record = await this.adapter.findById(id);
        if (!record || record.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.record_not_found', 'Bản ghi không tồn tại'), 404);
        }

        const updated = await this.adapter.updateById(id, {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
          },
        });

        return this.transformDocuments(ctx, {}, updated);
      },
    },
  },

  events: {
    'roleplay.analysis.completed': {
      async handler(payload) {
        const {sessionId, analysisId, analysisData, session} = payload;
        this.logger.info(
          `Nhận sự kiện 'roleplay.analysis.completed' cho sessionId: ${sessionId} - Bắt đầu cập nhật điểm kỹ năng`,
        );

        try {
          if (!analysisData || !analysisData.result || !analysisData.result.knowledgeAnalysis) {
            this.logger.warn(`Session ${sessionId} không có dữ liệu knowledgeAnalysis để cập nhật điểm kỹ năng`);
            return;
          }

          const {skillAnalyses} = analysisData.result.knowledgeAnalysis;

          if (!skillAnalyses || skillAnalyses.length === 0) {
            this.logger.warn(`Session ${sessionId} không có skillAnalyses để cập nhật điểm`);
            return;
          }

          const userId = session.studentId?._id?.toString() || session.studentId?.toString();
          const organizationId =
            session.studentId?.organizationId?.toString() || session.studentId?.organizationId?._id?.toString();

          if (!userId) {
            this.logger.error(`Không tìm thấy userId trong session ${sessionId}`);
            return;
          }

          const skillsToUpdate = skillAnalyses
            .filter(sa => sa.skillId && typeof sa.score === 'number')
            .map(sa => ({
              skillId: sa.skillId.toString(),
              skillName: sa.skillName || 'Không có tên',
              category: sa.category || undefined,
              score: Math.round(sa.score),
            }));

          if (skillsToUpdate.length === 0) {
            this.logger.warn(`Session ${sessionId} không có kỹ năng hợp lệ để cập nhật điểm`);
            return;
          }

          await this.broker.call('userskillscores.batchUpdateSkillScores', {
            userId,
            organizationId,
            skills: skillsToUpdate,
          });

          this.logger.info(`Đã cập nhật ${skillsToUpdate.length} kỹ năng cho user ${userId} từ session ${sessionId}`);
        } catch (error) {
          this.logger.error(
            `Lỗi khi cập nhật điểm kỹ năng từ sự kiện 'roleplay.analysis.completed' cho session ${sessionId}:`,
            error,
          );
        }
      },
    },
  },

  methods: {
    async beforeListOrFind(ctx) {
      const user = ctx.meta.user;
      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      ctx.params.query = ctx.params.query || {};
    },
  },

  created() {},

  async started() {
    this.logger.info('UserSkillScores service started');
  },

  async stopped() {
    this.logger.info('UserSkillScores service stopped');
  },
};
