'use strict';

const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const {RESOURCES, ACTIONS} = require('../../../constants/permissions');
const {MoodleClient} = require('../../moodle/moodle');

/**
 * Courses Service - Core Actions
 * Contains: copy, updateCourseByAI, create, remove, getCourse, getCourseDetails, getTasksOfCourse
 */

module.exports = {
  copy: {
    rest: 'POST /:id/copy',
    params: {
      id: {type: 'string'},
      options: {type: 'array', items: 'string', optional: true},
    },
    async handler(ctx) {
      const {id, options} = ctx.params;
      const user = ctx.meta.user;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const opts = options || ['all'];
      const copyScenarios = opts.includes('scenarios') || opts.includes('all');
      const copyMembers = opts.includes('members') || opts.includes('all');

      const originalCourse = await this.adapter.findById(id);
      if (!originalCourse || originalCourse.isDeleted) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }

      const newCourseName = await this.generateCopyName(this.adapter, originalCourse.name, {isDeleted: false});

      const newCourseData = {
        name: newCourseName,
        description: originalCourse.description,
        introduction: originalCourse.introduction,
        courseCategoryId: originalCourse.courseCategoryId,
        courseType: originalCourse.courseType || 'optional',
        startDate: originalCourse.startDate,
        deadline: originalCourse.deadline,
        isSequentialStudyRequired: originalCourse.isSequentialStudyRequired || false,
        thumbnailId: originalCourse.thumbnailId,
        thumbnailIds: originalCourse.thumbnailIds,
        references: originalCourse.references || [],
        organizationId: originalCourse.organizationId,
        status: 'draft',
        createdBy: user._id,
        updatedBy: user._id,
      };

      if (copyMembers) {
        newCourseData.publishedToUsers = originalCourse.publishedToUsers || [];
      }

      const newCourse = await this.adapter.insert(newCourseData);

      if (copyScenarios) {
        try {
          const scenarios = await ctx.call('aiscenarios.find', {query: {courseId: id, isDeleted: false}});
          if (scenarios && scenarios.length > 0) {
            for (const scenario of scenarios) {
              let aiPersonaId = null;
              if (scenario.aiPersonaId) {
                const personaIdStr =
                  typeof scenario.aiPersonaId === 'object' && scenario.aiPersonaId._id
                    ? scenario.aiPersonaId._id.toString()
                    : scenario.aiPersonaId.toString();

                const persona = await ctx.call('aipersonas.get', {id: personaIdStr, populate: []}).catch(() => null);
                if (persona && !persona.isDeleted) {
                  const newPersonaParams = {
                    name: `${persona.name} - Bản sao`.substring(0, 100),
                    avatarId: persona.avatarId?.toString(),
                    voiceId: persona.voiceId?.toString(),
                    llmModelId: persona.llmModelId?.toString(),
                    role: persona.role,
                    mood: persona.mood,
                    organization: persona.organization,
                    smallTalkLikely: persona.smallTalkLikely,
                    filterWords: persona.filterWords,
                    personaBackground: persona.personaBackground,
                    personaConcern: persona.personaConcern,
                    status: 'draft',
                    personaPrompt: persona.personaPrompt,
                    age: persona.age,
                    gender: persona.gender,
                    roleplayInstructionId: persona.roleplayInstructionId?.toString(),
                    conversationEndCondition: persona.conversationEndCondition,
                    conversationStyle: persona.conversationStyle,
                  };
                  const newPersona = await ctx.call('aipersonas.createAIPersona', newPersonaParams);
                  aiPersonaId = newPersona._id.toString();
                }
              }

              const validateRefs = [];
              if (scenario.references && scenario.references.length > 0 && newCourse.references) {
                const courseRefs = newCourse.references.map(r => r.toString());
                validateRefs.push(...scenario.references.filter(refId => courseRefs.includes(refId._id.toString())));
              }
              const newScenarioData = {
                courseId: newCourse._id.toString(),
                aiPersonaId: aiPersonaId,
                name: `${scenario.name} - Bản sao`,
                description: scenario.description,
                passScore: scenario.passScore,
                estimatedCallTimeInMinutes: scenario.estimatedCallTimeInMinutes,
                organizationId: scenario.organizationId?.toString() || user.organizationId?.toString(),
                aiSpeaksFirst: scenario.aiSpeaksFirst,
                initialAiMessage: scenario.initialAiMessage,
                enableStyleAnalysis: scenario.enableStyleAnalysis,
                simulationFormat: scenario.simulationFormat,
                references: validateRefs.map(r => r._id.toString()),
                scenarioCategoryId: scenario.scenarioCategoryId?.toString(),
                skillGroupIds: (scenario.skillGroupIds || []).map(sk => sk._id.toString()),
                studentDescription: scenario.studentDescription,
                aiDescription: scenario.aiDescription,
              };
              const newScenario = await ctx.call('aiscenarios.create', newScenarioData);

              const scenarioSkills = await ctx
                .call('scenarioskills.getSkillsByScenario', {scenarioId: scenario._id.toString()})
                .catch(() => null);
              if (scenarioSkills && scenarioSkills.length > 0) {
                const skillsConfig = scenarioSkills.map(sk => ({
                  skillId: sk.skillId?._id ? sk.skillId._id.toString() : sk.skillId.toString(),
                  weight: sk.weight,
                }));
                await ctx.call('scenarioskills.configureSkillsForScenario', {
                  scenarioId: newScenario._id.toString(),
                  skills: skillsConfig,
                });
              }
            }
          }
        } catch (error) {
          this.logger.error('Error copying scenarios:', error);
        }
      }

      return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, newCourse);
    },
  },

  updateCourseByAI: {
    rest: 'POST /:id/updateByAI',
    params: {
      id: {type: 'string'},
      userPrompt: {type: 'string', optional: true},
    },
    async handler(ctx) {
      const {id, userPrompt} = ctx.params;
      const user = ctx.meta.user;

      const course = await this.adapter.findById(id);
      if (!course || course.isDeleted) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }

      let referencesContent = '';
      if (course.references && course.references.length > 0) {
        const referenceObjects = await ctx.call('references.find', {
          query: {_id: {$in: course.references}, aiReadable: true},
        });
        referencesContent = referenceObjects.map(ref => ref.content || ref.url || ref.name).join('\n---\n');
      }

      let aiPersona;
      try {
        aiPersona = await ctx.call('aipersonas.createAIPersonaFromCourseContext', {
          courseId: id,
          courseName: course.name,
          courseDescription: course.description,
          courseReferencesContent: referencesContent,
          userPrompt: userPrompt ? `Liên quan đến AI Persona: ${userPrompt}` : undefined,
        });
      } catch (error) {
        throw new MoleculerClientError(
          'Lỗi khi AI tạo Persona: ' + error.message,
          error.code || 500,
          error.type || 'AI_PERSONA_ERROR',
        );
      }

      let generatedTasks;
      let taskPrompt = `Tên khóa học: ${course.name}`;
      if (course.description) taskPrompt += `\nMô tả: ${course.description}`;
      if (referencesContent) taskPrompt += `\nNội dung tham khảo chính: ${referencesContent.substring(0, 1500)}...`;
      if (aiPersona)
        taskPrompt += `\nAI Persona được tạo: ${aiPersona.name} (Vai trò: ${aiPersona.role}, Bối cảnh: ${aiPersona.personaBackground.substring(0, 200)}...)`;
      if (userPrompt) taskPrompt += `\nYêu cầu cụ thể từ người dùng cho tasks: ${userPrompt}`;

      try {
        const taskCreationResult = await ctx.call('tasks.createTasksFromPrompt', {
          courseId: id,
          prompt: taskPrompt,
          aiPersonaId: aiPersona ? aiPersona._id : undefined,
        });
        generatedTasks = taskCreationResult.tasks;
        this.logger.info(`${generatedTasks.length} tasks generated for course ${id}.`);
      } catch (error) {
        throw new MoleculerClientError(
          'Lỗi khi AI tạo Tasks: ' + error.message,
          error.code || 500,
          error.type || 'AI_TASK_ERROR',
        );
      }

      const taskIds = generatedTasks.map(t => t._id);

      let aiScenario;
      try {
        aiScenario = await ctx.call('aiscenarios.getFirstByCourse', {courseId: id});
        aiScenario = await ctx.call('aiscenarios.update', {
          id: aiScenario._id,
          aiPersonaId: aiPersona._id,
          taskIds: taskIds,
          updatedBy: user._id,
        });
      } catch (error) {
        aiScenario = await ctx.call('aiscenarios.create', {
          courseId: id,
          aiPersonaId: aiPersona._id,
          taskIds: taskIds,
          name: `${course.name} - Scenario`,
          description: `AI scenario for ${course.name}`,
          organizationId: course.organizationId,
          createdBy: user._id,
          updatedBy: user._id,
        });
      }

      const updatedCourse = await this.adapter.updateById(id, {
        $set: {updatedBy: user._id, updatedAt: new Date()},
      });

      this.broker.emit('courses.updatedByAI', {course: updatedCourse, user, aiPersona, generatedTasks, aiScenario});
      return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, updatedCourse);
    },
  },

  // Tạo khóa học mới
  create: {
    rest: 'POST /',
    params: {
      name: {type: 'string', min: 2, max: 255},
      description: {type: 'string', optional: true, max: 5000},
      introduction: {type: 'string', optional: true, max: 5000},
      referenceUrls: {type: 'array', optional: true, items: 'string'},
      referenceFiles: {type: 'array', optional: true, items: 'string'},
      courseType: {type: 'enum', values: ['mandatory', 'optional'], optional: true},
      courseCategoryId: {type: 'string', optional: true},
      isSequentialStudyRequired: {type: 'boolean', optional: true},
      isActive: {type: 'boolean', optional: true},
      organizationId: {type: 'string', optional: true},
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
      courseimage: {type: 'string', optional: true},
      moodleCourseId: {type: 'number', optional: true},
      thumbnailIds: {type: 'array', items: 'string', optional: true, max: 5},
    },
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.CREATE},
    async handler(ctx) {
      const {
        name,
        description,
        introduction,
        references,
        courseType,
        courseCategoryId,
        deadline,
        startDate,
        publishedToUsers,
        moodleCourseId,
        thumbnailId,
        thumbnailIds,
        isSequentialStudyRequired,
        isActive,
        organizationId,
      } = ctx.params;
      const user = ctx.meta.user;
      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const courseData = {
        name,
        description,
        introduction,
        references: references || [],
        courseType,
        courseCategoryId,
        organizationId: organizationId || user.organizationId,
        publishedToUsers: publishedToUsers || [],
        createdBy: user._id,
        updatedBy: user._id,
        status: 'draft',
        thumbnailId,
        thumbnailIds,
        deadline,
        startDate,
        isSequentialStudyRequired,
        isActive: isActive !== undefined ? isActive : true,
      };

      if (moodleCourseId) {
        courseData.moodleCourseId = moodleCourseId;
        try {
          const moodleSettings = await this.getMoodleSettings();
          const moodleClient = new MoodleClient(moodleSettings.baseUrl, moodleSettings.moodleToken);
          const courseDetails = await moodleClient.getCourseById(moodleCourseId);
          if (courseDetails && courseDetails.courseimage && !thumbnailId) {
            try {
              const thumbnailFile = await this.downloadImageFromUrl(courseDetails.courseimage, user._id);
              if (thumbnailFile && thumbnailFile._id) {
                courseData.thumbnailId = thumbnailFile._id;
              }
            } catch (error) {
              this.logger.error('Error downloading course image from Moodle:', error);
            }
          }
        } catch (error) {
          this.logger.error('Error fetching Moodle course details:', error);
        }
      }

      function normalizeStart(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
      }

      function normalizeEnd(date) {
        const d = new Date(date);
        d.setHours(23, 59, 59, 999);
        return d;
      }

      const now = new Date();
      now.setHours(0, 0, 0, 0);

      let startDateObj = null;
      let deadlineDate = null;

      if (startDate) {
        startDateObj = normalizeStart(startDate);
        if (startDateObj < now) {
          throw new MoleculerClientError('Ngày bắt đầu không được nhỏ hơn ngày hiện tại', 400);
        }
      }

      if (deadline) {
        deadlineDate = normalizeEnd(deadline);
        if (deadlineDate < now) {
          throw new MoleculerClientError('Deadline không được nhỏ hơn ngày hiện tại', 400);
        }
      }

      if (startDateObj && deadlineDate && startDateObj > deadlineDate) {
        throw new MoleculerClientError('Ngày bắt đầu không được sau ngày kết thúc', 400);
      }

      if (publishedToUsers && publishedToUsers.length > 0) {
        courseData.status = 'published';
      }

      let expired_status = 'pending';
      if (deadlineDate) {
        const nowTime = new Date();
        const threeDaysLater = new Date(nowTime.getTime() + 3 * 24 * 60 * 60 * 1000);
        if (courseType === 'optional') {
          expired_status = 'pending';
        } else {
          if (deadlineDate < nowTime) expired_status = 'overdue';
          else if (deadlineDate <= threeDaysLater) expired_status = 'due_soon';
          else expired_status = 'pending';
        }
      }

      courseData.expired_status = expired_status;

      const course = await this.adapter.insert(courseData);
      return this.transformDocuments(ctx, {}, course);
    },
  },

  remove: {
    rest: 'DELETE /:id',
    params: {id: {type: 'string'}},
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.DELETE},
    async handler(ctx) {
      const {id} = ctx.params;
      const user = ctx.meta.user;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }
      const course = await this.adapter.findById(id);
      if (!course || course.isDeleted) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }

      if (course.status === 'completed') {
        throw new MoleculerClientError(
          i18next.t('error.cannot_delete_completed_course', 'Không thể xóa khóa học đã hoàn thành 100%'),
          400,
          'COURSE_COMPLETED',
        );
      }

      const isFullyCompleted = await this.checkCourseFullyCompleted(ctx, course);
      if (isFullyCompleted) {
        throw new MoleculerClientError(
          i18next.t('error.cannot_delete_completed_course', 'Không thể xóa khóa học đã hoàn thành 100%'),
          400,
          'COURSE_COMPLETED',
        );
      }

      const hasPermission = user.isSystemAdmin || user._id.toString() === course.createdBy.toString();
      if (!hasPermission) {
        throw new MoleculerClientError(
          i18next.t('error.permission_denied', 'Bạn không có quyền xóa khóa học này'),
          403,
        );
      }

      await this.adapter.updateById(id, {
        $set: {isDeleted: true, deletedAt: new Date(), updatedBy: user._id},
      });

      try {
        const scenarios = await ctx.call('aiscenarios.find', {
          query: {courseId: id, isDeleted: false},
          fields: ['_id'],
        });

        if (scenarios && scenarios.length > 0) {
          const scenarioIds = scenarios.map(s => (s._id._id || s._id).toString());

          const sessions = await ctx.call('roleplaysessions.find', {
            query: {aiScenarioId: {$in: scenarioIds}, isDeleted: false},
            fields: ['_id', 'analysisId'],
          });

          const bulkOps = [
            ctx
              .call('aiscenarios.bulkSoftDelete', {query: {courseId: id}, updatedBy: user._id.toString()})
              .catch(err => this.logger.error('Error bulk deleting scenarios:', err)),
            ctx
              .call('scenarioskills.bulkSoftDeleteByScenarios', {scenarioIds})
              .catch(err => this.logger.error('Error bulk deleting scenario skills:', err)),
          ];

          if (sessions && sessions.length > 0) {
            const sessionIds = sessions.map(s => (s._id._id || s._id).toString());
            const analysisIds = sessions
              .filter(s => s.analysisId)
              .map(s => (s.analysisId._id || s.analysisId).toString());

            bulkOps.push(
              ctx
                .call('roleplaysessions.bulkSoftDelete', {ids: sessionIds})
                .catch(err => this.logger.error('Error bulk deleting sessions:', err)),
            );

            if (analysisIds.length > 0) {
              bulkOps.push(
                ctx
                  .call('roleplay.analysises.bulkSoftDelete', {ids: analysisIds})
                  .catch(err => this.logger.error('Error bulk deleting analyses:', err)),
              );
            }
          }

          await Promise.all(bulkOps);
          this.logger.info(`Cascade deleted ${scenarioIds.length} scenarios for course ${id}`);
        }
      } catch (error) {
        this.logger.error(`Error in cascade cleanup for course ${id}:`, error);
      }

      return {success: true, id};
    },
  },

  // Lấy chi tiết khóa học
  getCourse: {
    rest: 'GET /:id',
    params: {
      id: {type: 'string'},
      withScenarios: {type: 'boolean', optional: true, default: false},
    },
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.VIEW},
    async handler(ctx) {
      console.log('getCourse', ctx.params);
      const {id, withScenarios} = ctx.params;

      const course = await this.adapter.findOne({_id: id, isDeleted: {$ne: true}});
      if (!course) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }

      const data = await this.transformDocuments(ctx, {populate: this.settings.populateOptions}, course);

      if (data.publishedToUsers && Array.isArray(data.publishedToUsers)) {
        const userIds = data.publishedToUsers
          .map(entry => entry?.userId?._id?.toString() || entry?.userId?.toString())
          .filter(Boolean);

        if (userIds.length > 0) {
          try {
            const fullUsers = await ctx.call('users.get', {
              id: userIds,
              populate: ['roleId', 'organizationId.parentOrganizationId'],
            });
            const userMap = {};
            fullUsers.forEach(u => {
              userMap[u._id.toString()] = u;
            });

            data.publishedToUsers = data.publishedToUsers.map(entry => {
              const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
              const fullUser = userMap[uid];
              return fullUser ? {...fullUser, courseType: entry.courseType} : entry;
            });
          } catch (err) {
            this.logger.error('Error fetching full users for publishedToUsers', err);
          }
        }
      }

      if (withScenarios) {
        const scenarios = await ctx.call('aiscenarios.getByCourse', {courseId: id});
        data.scenarios = scenarios;
      }

      return data;
    },
  },

  // Lấy chi tiết khóa học với scenarios (alias cho getCourse với withScenarios=true)
  getCourseDetails: {
    rest: 'GET /:id/details',
    params: {id: {type: 'string'}},
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.VIEW},
    async handler(ctx) {
      return ctx.call('courses.getCourse', {id: ctx.params.id, withScenarios: true});
    },
  },

  // Lấy danh sách nhiệm vụ của khóa học từ AI scenarios
  getTasksOfCourse: {
    rest: 'GET /:id/tasks',
    params: {
      id: {type: 'string'},
      scenarioId: {type: 'string', optional: true},
    },
    async handler(ctx) {
      const {id, scenarioId} = ctx.params;

      const course = await this.adapter.findOne({_id: id, isDeleted: {$ne: true}});
      if (!course) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }

      if (scenarioId) {
        return await this.getTasksFromSpecificScenario(ctx, id, scenarioId);
      } else {
        return await this.getTasksFromAllScenarios(ctx, id);
      }
    },
  },
};
