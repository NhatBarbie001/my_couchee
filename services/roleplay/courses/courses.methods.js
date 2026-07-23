'use strict';

/**
 * Courses Service - Methods
 * Contains all helper/utility methods used by the courses service.
 */

module.exports = {
  async checkCourseFullyCompleted(ctx, course) {
    try {
      const courseId = course._id.toString();
      const publishedUsers = course.publishedToUsers || [];
      if (publishedUsers.length === 0) return false;

      const userIds = publishedUsers
        .map(entry => entry?.userId?._id?.toString() || entry?.userId?.toString())
        .filter(Boolean);
      if (userIds.length === 0) return false;

      const scenarios = await this.broker.call('aiscenarios.find', {
        query: {courseId, isDeleted: false, status: 'published'},
      });
      if (!scenarios || scenarios.length === 0) return false;

      const aggregatedResult = await this.broker.call('roleplaysessions.aggregateCompletedSessions', {
        courseIds: [courseId],
      });
      const allSessions = aggregatedResult.allSessions || [];

      const scenarioPassScores = {};
      scenarios.forEach(s => {
        scenarioPassScores[s._id.toString()] = s.passScore ?? 70;
      });

      const studentBestScores = {};
      for (const item of allSessions) {
        const studentId = item.studentId?.toString();
        const scenarioId = item.aiScenarioId?.toString();
        const bestScore = item.bestScore;
        if (!studentId || !scenarioId) continue;

        if (!studentBestScores[studentId]) studentBestScores[studentId] = {};
        studentBestScores[studentId][scenarioId] = bestScore;
      }

      for (const userId of userIds) {
        const bestScores = studentBestScores[userId] || {};

        for (const scenarioId in scenarioPassScores) {
          const studentScore = bestScores[scenarioId];
          if (studentScore === undefined || studentScore < scenarioPassScores[scenarioId]) {
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      this.logger.error('Error in checkCourseFullyCompleted:', error);
      return false;
    }
  },

  buildRemoveMembersMessage(removedUserIds, rejectedUsers, cleanedUpSessionCounts) {
    const parts = [];
    if (removedUserIds.length > 0) {
      parts.push(`Đã xóa thành công ${removedUserIds.length} học viên khỏi khóa học.`);
    }
    if (rejectedUsers.length > 0) {
      parts.push(`Không thể xóa ${rejectedUsers.length} học viên do đã tham gia phiên thực hành.`);
    }
    const totalCleanedSessions = Object.values(cleanedUpSessionCounts).reduce((sum, count) => sum + count, 0);
    if (totalCleanedSessions > 0) {
      parts.push(`Đã xóa ${totalCleanedSessions} phiên thực hành liên quan.`);
    }
    if (parts.length === 0) {
      return 'Không có học viên nào được xóa.';
    }
    return parts.join(' ');
  },

  /**
   * Xóa lịch sử tiến độ học tập của một thành viên trong khóa học.
   * Bao gồm: phiên thực hành (roleplaysessions) và kết quả phân tích (analysis).
   * @param {Object} ctx - Moleculer context
   * @param {string} courseId - ID khóa học
   * @param {string} userId - ID thành viên cần xóa lịch sử
   * @returns {number} Số phiên thực hành đã xóa
   */
  async cleanupMemberLearningHistory(ctx, courseId, userId) {
    const sessions = await ctx.call('roleplaysessions.find', {
      query: {
        studentId: userId,
        courseId: courseId,
        isDeleted: {$ne: true},
        status: {$in: ['completed', 'analyzed']},
      },
    });

    if (!sessions || sessions.length === 0) {
      return 0;
    }

    for (const session of sessions) {
      if (session.analysisId) {
        try {
          const analysisId = session.analysisId._id ? session.analysisId._id.toString() : session.analysisId.toString();
          await ctx.call('roleplay.analysises.update', {
            id: analysisId,
            isDeleted: true,
            deletedAt: new Date(),
          });
        } catch (err) {
          this.logger.error(`Error deleting analysis ${session.analysisId} for session ${session._id}:`, err);
        }
      }

      try {
        await ctx.call('roleplaysessions.update', {
          id: session._id.toString(),
          isDeleted: true,
          deletedAt: new Date(),
        });
      } catch (err) {
        this.logger.error(`Error deleting session ${session._id}:`, err);
      }
    }

    this.logger.info(`Cleaned up ${sessions.length} practice sessions for user ${userId} in course ${courseId}`);
    return sessions.length;
  },

  buildWeakSkillsSummary(weakSkillsMap) {
    const summary = {};
    for (const [skillId, data] of weakSkillsMap) {
      summary[skillId] = {
        skillName: data.skillName,
        avgScore: data.count > 0 ? Math.round(data.totalScore / data.count) : 0,
        userCount: data.userIds.length,
      };
    }
    return summary;
  },

  async getMoodleSettings() {
    const moodleSettings = await this.broker.call('moodle.findOne');

    if (!moodleSettings) {
      throw new Error('Moodle settings not found in database');
    }

    if (moodleSettings.status !== 'active') {
      throw new Error('Moodle integration is currently inactive. Please contact administrator.');
    }

    if (moodleSettings.isDeleted) {
      throw new Error('Moodle settings have been deleted');
    }

    return moodleSettings;
  },

  async downloadImageFromUrl(imageUrl, userId) {
    const https = require('https');
    const http = require('http');
    const path = require('path');
    const fs = require('fs');
    const {v4: uuidv4} = require('uuid');

    return new Promise((resolve, reject) => {
      const protocol = imageUrl.startsWith('https') ? https : http;

      protocol
        .get(imageUrl, response => {
          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download image: ${response.statusCode}`));
            return;
          }

          const contentType = response.headers['content-type'];
          let extension = '.jpg';

          if (contentType) {
            if (contentType.includes('png')) extension = '.png';
            else if (contentType.includes('jpeg') || contentType.includes('jpg')) extension = '.jpg';
            else if (contentType.includes('gif')) extension = '.gif';
            else if (contentType.includes('webp')) extension = '.webp';
          }

          const uniqueFileName = `moodle_course_${uuidv4()}${extension}`;
          const storageFolder = 'course_thumbnails';
          const storagePath = path.join(__dirname, '../../../services/File/storage');
          const dirPath = path.join(storagePath, storageFolder);

          if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, {recursive: true});
          }

          const filePath = path.join(dirPath, uniqueFileName);
          const fileStream = fs.createWriteStream(filePath);

          response.pipe(fileStream);

          fileStream.on('finish', async () => {
            fileStream.close();

            try {
              const stat = fs.statSync(filePath);

              const fileObject = {
                ownerId: userId,
                name: uniqueFileName,
                displayName: uniqueFileName,
                fileType: 'image',
                size: stat.size.toString(),
                mimetype: contentType || 'image/jpeg',
                storageType: 'local_storage',
                storageLocation: storageFolder,
                used: true,
              };

              const file = await this.broker.call('files.insert', {entity: fileObject});
              resolve(file);
            } catch (error) {
              this.logger.error('Error creating file record:', error);
              reject(error);
            }
          });

          fileStream.on('error', error => {
            fs.unlink(filePath, () => {});
            reject(error);
          });
        })
        .on('error', error => {
          reject(error);
        });
    });
  },

  async downloadFileFromMoodle(fileUrl, originalFilename, mimetype, userId) {
    const https = require('https');
    const http = require('http');
    const path = require('path');
    const fs = require('fs');
    const {v4: uuidv4} = require('uuid');

    const moodleSettings = await this.getMoodleSettings();
    const token = moodleSettings.moodleToken;

    let downloadUrl = fileUrl;
    if (!downloadUrl.includes('token=')) {
      const separator = downloadUrl.includes('?') ? '&' : '?';
      downloadUrl = `${downloadUrl}${separator}token=${token}`;
    }

    this.logger.info(`Downloading file from Moodle: ${downloadUrl}`);

    return new Promise((resolve, reject) => {
      const protocol = downloadUrl.startsWith('https') ? https : http;

      protocol
        .get(downloadUrl, response => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            this.logger.info(`Redirected to: ${redirectUrl}`);
            return this.downloadFileFromMoodle(redirectUrl, originalFilename, mimetype, userId)
              .then(resolve)
              .catch(reject);
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download file: ${response.statusCode}`));
            return;
          }

          const contentType = mimetype || response.headers['content-type'];
          const extension = originalFilename.split('.').pop();
          const uniqueFileName = `moodle_resource_${uuidv4()}.${extension}`;
          const storageFolder = 'roleplay/references';
          const storagePath = path.join(__dirname, '../../../services/File/storage');
          const dirPath = path.join(storagePath, storageFolder);

          if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, {recursive: true});
          }

          const filePath = path.join(dirPath, uniqueFileName);
          const fileStream = fs.createWriteStream(filePath);

          response.pipe(fileStream);

          fileStream.on('finish', async () => {
            fileStream.close();

            try {
              const stat = fs.statSync(filePath);

              this.logger.info(`Saved file: ${filePath} (${stat.size} bytes)`);

              let fileType = 'document';
              const ext = extension.toLowerCase();
              if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(ext)) {
                fileType = 'image';
              } else if (['mp4', 'avi', 'mov', 'wmv'].includes(ext)) {
                fileType = 'video';
              } else if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) {
                fileType = 'audio';
              } else if (['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
                fileType = 'document';
              }

              const fileObject = {
                ownerId: userId,
                name: uniqueFileName,
                displayName: originalFilename,
                fileType: fileType,
                size: stat.size.toString(),
                mimetype: contentType || 'application/octet-stream',
                storageType: 'local_storage',
                storageLocation: storageFolder,
                used: true,
              };

              const file = await this.broker.call('files.insert', {entity: fileObject});
              this.logger.info(`Created file record: ${file._id}`);
              resolve(file);
            } catch (error) {
              this.logger.error('Error creating file record:', error);
              reject(error);
            }
          });

          fileStream.on('error', error => {
            fs.unlink(filePath, () => {});
            reject(error);
          });
        })
        .on('error', error => {
          reject(error);
        });
    });
  },

  async getTasksFromSpecificScenario(ctx, courseId, scenarioId) {
    const i18next = require('i18next');
    const {MoleculerClientError} = require('moleculer').Errors;

    try {
      const scenario = await ctx.call('aiscenarios.get', {id: scenarioId});
      if (!scenario || scenario.courseId.toString() !== courseId) {
        throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'Không tìm thấy kịch bản'), 404);
      }

      if (!scenario.taskIds || scenario.taskIds.length === 0) {
        return {
          tasks: [],
          scenarios: [scenario],
          totalTasks: 0,
          message: 'Scenario không có nhiệm vụ nào',
        };
      }

      const tasks = await ctx.call('tasks.find', {
        query: {
          _id: {$in: scenario.taskIds},
          isDeleted: {$ne: true},
        },
        sort: 'orderInScenario',
      });

      const tasksWithScenario = (tasks || []).map(task => ({
        ...task,
        scenario: {
          _id: scenario._id,
          name: scenario.name,
          description: scenario.description,
          aiPersonaId: scenario.aiPersonaId,
        },
      }));

      return {
        tasks: tasksWithScenario,
        scenarios: [scenario],
        totalTasks: tasksWithScenario.length,
      };
    } catch (error) {
      if (error.code === 404) {
        throw error;
      }
      this.logger.error(`Error getting tasks from scenario ${scenarioId}:`, error);
      throw new MoleculerClientError('Lỗi khi lấy nhiệm vụ từ kịch bản', 500);
    }
  },

  async getTasksFromAllScenarios(ctx, courseId) {
    const {MoleculerClientError} = require('moleculer').Errors;

    try {
      const scenarios = await ctx.call('aiscenarios.getByCourse', {courseId});
      if (!scenarios || scenarios.length === 0) {
        return {
          tasks: [],
          scenarios: [],
          totalTasks: 0,
          message: 'Khóa học chưa có kịch bản nào',
        };
      }

      const allTaskIds = [];
      const scenarioMap = new Map();

      scenarios.forEach(scenario => {
        if (scenario.taskIds && scenario.taskIds.length > 0) {
          scenario.taskIds.forEach(taskId => {
            allTaskIds.push(taskId._id);
            scenarioMap.set(taskId._id.toString(), {
              _id: scenario._id,
              name: scenario.name,
              description: scenario.description,
              aiPersonaId: scenario.aiPersonaId,
            });
          });
        }
      });

      if (allTaskIds.length === 0) {
        return {
          tasks: [],
          scenarios: scenarios,
          totalTasks: 0,
          message: 'Tất cả kịch bản đều chưa có nhiệm vụ',
        };
      }

      const tasks = await ctx.call('tasks.find', {
        query: {
          _id: {$in: allTaskIds},
          isDeleted: {$ne: true},
        },
        sort: 'orderInScenario',
      });

      const tasksWithScenario = (tasks || []).map(task => ({
        ...task,
        scenario: scenarioMap.get(task._id.toString()) || null,
      }));

      tasksWithScenario.sort((a, b) => {
        if (a.scenario && b.scenario && a.scenario._id !== b.scenario._id) {
          return a.scenario._id.localeCompare(b.scenario._id);
        }
        return (a.orderInScenario || 0) - (b.orderInScenario || 0);
      });

      return {
        tasks: tasksWithScenario,
        scenarios: scenarios,
        totalTasks: tasksWithScenario.length,
      };
    } catch (error) {
      this.logger.error(`Error getting tasks from all scenarios of course ${courseId}:`, error);
      throw new MoleculerClientError('Lỗi khi lấy nhiệm vụ từ các kịch bản', 500);
    }
  },

  async batchGetScenariosByCourses(ctx, courseIds) {
    try {
      if (!courseIds || courseIds.length === 0) {
        return [];
      }

      const allScenarios = await ctx.call('aiscenarios.find', {
        query: {
          courseId: {$in: courseIds},
          isDeleted: {$ne: true},
          status: 'published',
        },
        fields: ['_id', 'courseId', 'estimatedCallTimeInMinutes', 'passScore'],
      });
      return allScenarios || [];
    } catch (error) {
      this.logger.error('Error batch getting scenarios by courses:', error);
      return [];
    }
  },

  parseCompletionPercentage(value) {
    if (!value || typeof value !== 'string') return 0;

    const [completed, total] = value.split('/').map(Number);

    if (!total || Number.isNaN(completed) || Number.isNaN(total)) return 0;

    return Math.round((completed / total) * 100);
  },

  calculateCompletionPercentageFromData(scenarios, sessions) {
    try {
      if (!scenarios || scenarios.length === 0) {
        return '0/0';
      }

      const scenarioPassScores = new Map();
      scenarios.forEach(scenario => {
        scenarioPassScores.set(scenario._id.toString(), scenario.passScore || 70);
      });

      const completedScenarioIds = new Set();

      for (const session of sessions) {
        const simulationScore = session.analysisId?.result?.simulationScore;
        if (session.aiScenarioId && simulationScore !== undefined) {
          const scenarioId = session.aiScenarioId._id
            ? session.aiScenarioId._id.toString()
            : session.aiScenarioId.toString();
          const requiredScore = scenarioPassScores.get(scenarioId) || 70;

          if (simulationScore >= requiredScore) {
            completedScenarioIds.add(scenarioId);
          }
        }
      }

      const totalScenarios = scenarios.length;
      const completedScenarios = scenarios.filter(scenario => completedScenarioIds.has(scenario._id.toString())).length;

      return `${completedScenarios || 0}/${totalScenarios || 0}`;
    } catch (error) {
      this.logger.error('Error calculating completion percentage from data:', error);
      return 0;
    }
  },

  calculateCompletionFromAggregatedData(scenarios, userAggregatedSessions) {
    try {
      if (!scenarios || scenarios.length === 0) {
        return '0/0';
      }

      const scenarioPassScores = new Map();
      scenarios.forEach(scenario => {
        scenarioPassScores.set(scenario._id.toString(), scenario.passScore || 70);
      });

      const completedScenarioIds = new Set();

      for (const session of userAggregatedSessions) {
        const bestScore = session.bestScore;
        if (session.aiScenarioId && bestScore !== undefined) {
          const scenarioId = session.aiScenarioId.toString();
          const requiredScore = scenarioPassScores.get(scenarioId) || 70;

          if (bestScore >= requiredScore) {
            completedScenarioIds.add(scenarioId);
          }
        }
      }

      const totalScenarios = scenarios.length;
      const completedScenarios = scenarios.filter(scenario => completedScenarioIds.has(scenario._id.toString())).length;

      return `${completedScenarios || 0}/${totalScenarios || 0}`;
    } catch (error) {
      this.logger.error('Error calculating completion from aggregated data:', error);
      return '0/0';
    }
  },

  async batchCalculateTotalMembers(ctx, courses) {
    try {
      if (!courses?.length) return {};

      const allUserIds = new Set();

      courses.forEach(course => {
        (course.publishedToUsers || []).forEach(entry => {
          const id = entry?.userId?._id?.toString() || entry?.userId?.toString();
          if (id) allUserIds.add(id);
        });
      });

      let validUserIds = new Set();
      if (allUserIds.size > 0) {
        const validUsers = await ctx.call('users.find', {
          query: {
            _id: {$in: [...allUserIds]},
            isDeleted: false,
          },
          fields: ['_id'],
        });
        validUsers.forEach(u => validUserIds.add(u._id.toString()));
      }

      const result = {};
      for (const course of courses) {
        const courseId = course._id.toString();
        const courseValidUserIds = new Set();

        const directUserIds = (course.publishedToUsers || [])
          .map(entry => {
            return entry?.userId?._id?.toString() || entry?.userId?.toString();
          })
          .filter(Boolean);
        for (const userId of directUserIds) {
          if (validUserIds.has(userId)) {
            courseValidUserIds.add(userId);
          }
        }

        result[courseId] = {
          count: courseValidUserIds.size,
          validUserIds: courseValidUserIds,
        };
      }

      return result;
    } catch (error) {
      this.logger.error('Error in batchCalculateTotalMembers:', error);
      return {};
    }
  },

  calculateCompletedMembersFromAggregatedData(courseIds, courses, allScenarios, aggregatedSessions, totalMembersMap) {
    try {
      if (!courseIds?.length) return {};

      const scenariosByCourse = {};
      for (const scenario of allScenarios) {
        const courseId = scenario.courseId?._id ? scenario.courseId._id.toString() : scenario.courseId?.toString();
        if (!courseId) continue;
        if (!scenariosByCourse[courseId]) scenariosByCourse[courseId] = [];
        scenariosByCourse[courseId].push(scenario);
      }

      const aggregatedByCourse = {};
      for (const item of aggregatedSessions) {
        const courseId = item.courseId?.toString();
        const studentId = item.studentId?.toString();
        const scenarioId = item.aiScenarioId?.toString();
        const bestScore = item.bestScore;

        if (!courseId || !studentId || !scenarioId) continue;

        if (!aggregatedByCourse[courseId]) aggregatedByCourse[courseId] = {};
        if (!aggregatedByCourse[courseId][studentId]) aggregatedByCourse[courseId][studentId] = {};
        aggregatedByCourse[courseId][studentId][scenarioId] = bestScore;
      }

      const result = {};

      for (const cId of courseIds) {
        const courseId = cId.toString();
        const courseScenarios = scenariosByCourse[courseId] || [];

        if (!courseScenarios.length) {
          result[courseId] = 0;
          continue;
        }

        const scenarioPassScores = {};
        courseScenarios.forEach(s => {
          scenarioPassScores[s._id.toString()] = s.passScore ?? 70;
        });

        const studentBestScores = aggregatedByCourse[courseId] || {};

        const validUserIds = totalMembersMap[courseId]?.validUserIds || new Set();

        let passedCount = 0;
        for (const studentId in studentBestScores) {
          if (!validUserIds.has(studentId)) continue;

          const bestScores = studentBestScores[studentId];
          let passedAll = true;

          for (const scenarioId in scenarioPassScores) {
            const studentScore = bestScores[scenarioId];
            if (studentScore === undefined || studentScore < scenarioPassScores[scenarioId]) {
              passedAll = false;
              break;
            }
          }

          if (passedAll) {
            passedCount++;
          }
        }

        result[courseId] = passedCount;
      }

      return result;
    } catch (error) {
      this.logger.error('Error in calculateCompletedMembersFromAggregatedData:', error);
      return {};
    }
  },

  calculateCompletedMemberIdsFromAggregatedData(courseIds, courses, allScenarios, aggregatedSessions, totalMembersMap) {
    try {
      if (!courseIds?.length) return {};

      const scenariosByCourse = {};
      for (const scenario of allScenarios) {
        const courseId = scenario.courseId?._id ? scenario.courseId._id.toString() : scenario.courseId?.toString();
        if (!courseId) continue;

        if (!scenariosByCourse[courseId]) scenariosByCourse[courseId] = [];
        scenariosByCourse[courseId].push(scenario);
      }

      const aggregatedByCourse = {};
      for (const item of aggregatedSessions) {
        const courseId = item.courseId?.toString();
        const studentId = item.studentId?.toString();
        const scenarioId = item.aiScenarioId?.toString();
        const bestScore = item.bestScore;

        if (!courseId || !studentId || !scenarioId) continue;

        if (!aggregatedByCourse[courseId]) aggregatedByCourse[courseId] = {};
        if (!aggregatedByCourse[courseId][studentId]) aggregatedByCourse[courseId][studentId] = {};
        aggregatedByCourse[courseId][studentId][scenarioId] = bestScore;
      }

      const result = {};

      for (const cId of courseIds) {
        const courseId = cId.toString();
        const courseScenarios = scenariosByCourse[courseId] || [];

        if (!courseScenarios.length) {
          result[courseId] = [];
          continue;
        }

        const scenarioPassScores = {};
        courseScenarios.forEach(s => {
          scenarioPassScores[s._id.toString()] = s.passScore ?? 70;
        });

        const studentBestScores = aggregatedByCourse[courseId] || {};
        const validUserIds = totalMembersMap[courseId]?.validUserIds || new Set();

        const passedUserIds = [];

        for (const studentId in studentBestScores) {
          if (!validUserIds.has(studentId)) continue;

          const bestScores = studentBestScores[studentId];
          let passedAll = true;

          for (const scenarioId in scenarioPassScores) {
            const studentScore = bestScores[scenarioId];
            if (studentScore === undefined || studentScore < scenarioPassScores[scenarioId]) {
              passedAll = false;
              break;
            }
          }

          if (passedAll) {
            passedUserIds.push(studentId);
          }
        }

        result[courseId] = passedUserIds;
      }

      return result;
    } catch (error) {
      this.logger.error('Error in calculateCompletedMemberIdsFromAggregatedData:', error);
      return {};
    }
  },

  async migrateCourseTypes() {
    try {
      this.logger.info('Starting course type migration...');

      const coursesToUpdate = await this.adapter.find({query: {courseType: {$exists: false}}});

      this.logger.info(`Found ${coursesToUpdate.length} courses to update`);

      for (const course of coursesToUpdate) {
        await this.adapter.updateById(course._id, {$set: {courseType: 'optional'}});
        this.logger.info(`Updated course ${course._id} with default courseType`);
      }

      this.logger.info('Migration completed!');
      return {updated: coursesToUpdate.length};
    } catch (error) {
      this.logger.error('Error in migrateCourseTypes:', error);
      return {updated: 0, error: error.message};
    }
  },
};
