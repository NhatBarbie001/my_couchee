'use strict';

const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const {RESOURCES, ACTIONS} = require('../../../constants/permissions');

/**
 * Courses Service - Publish & Members Actions
 * Contains: exportCourse, publishCoursesToSelectedUsers, removeMembers,
 *           addReferenceToCourse, removeReferenceFromCourse
 */

module.exports = {
  // Xuất bản khóa học
  exportCourse: {
    rest: 'POST /:id/export',
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.UPDATE},
    params: {
      id: {type: 'string'},
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
      status: {type: 'enum', values: ['draft', 'published', 'archived', 'completed'], optional: true},
    },
    async handler(ctx) {
      const {id, publishedToUsers, status} = ctx.params;
      const user = ctx.meta.user;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const course = await this.adapter.findById(id);
      if (!course || course.isDeleted) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }

      let newlyAddedUsers = [];
      let removedUsers = [];

      if (Array.isArray(publishedToUsers)) {
        const currentUserIds = (course.publishedToUsers || [])
          .map(entry => {
            const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
            return uid;
          })
          .filter(Boolean);
        const incomingUserIds = publishedToUsers
          .map(entry => entry?.userId?.toString() || entry?.toString())
          .filter(Boolean);
        newlyAddedUsers = incomingUserIds.filter(uid => !currentUserIds.includes(uid));
        removedUsers = currentUserIds.filter(uid => !incomingUserIds.includes(uid));
        
        course.publishedToUsers = publishedToUsers.map(entry => {
          if (typeof entry === 'object' && entry.userId) {
            return {userId: entry.userId, courseType: entry.courseType || course.courseType || 'optional'};
          }
          return {userId: entry, courseType: course.courseType || 'optional'};
        });
      }

      let orgStudentIds = [];

      if (status) course.status = status;

      await this.adapter.updateById(id, {
        $set: {
          publishedToUsers: course.publishedToUsers,
          status: course.status,
        },
      });

      const allNewUsers = Array.from(new Set([...newlyAddedUsers, ...orgStudentIds]));

      if (allNewUsers.length > 0 && status === 'published') {
        ctx.emit('course.users.added', {
          courseId: id,
          userIds: allNewUsers,
          actorId: user._id,
          lang: ctx.meta.lang,
        });
      }

      return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, course);
    },
  },

  publishCoursesToSelectedUsers: {
    rest: 'POST /:id/publish-to-users',
    params: {
      id: {type: 'string'},
      userIds: {type: 'array', items: 'string', min: 1},
      courseType: {type: 'string', enum: ['mandatory', 'optional'], optional: true},
      sendEmail: {type: 'boolean', optional: true, default: true},
    },
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.UPDATE},
    async handler(ctx) {
      const {id, userIds, courseType = 'mandatory', sendEmail} = ctx.params;
      const user = ctx.meta.user;
      const now = new Date();

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const course = await this.adapter.findById(id);
      if (!course || course.isDeleted) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }

      if (course.status !== 'published') {
        throw new MoleculerClientError('Chỉ có thể gửi khóa học đã được xuất bản (published)', 400);
      }

      if (course.startDate && new Date(course.startDate) > now) {
        throw new MoleculerClientError(
          `Khóa học chưa bắt đầu. Ngày bắt đầu: ${new Date(course.startDate).toLocaleDateString('vi-VN')}`,
          400,
        );
      }

      if (course.deadline && new Date(course.deadline) <= now) {
        throw new MoleculerClientError(
          `Khóa học đã hết hạn. Deadline: ${new Date(course.deadline).toLocaleDateString('vi-VN')}`,
          400,
        );
      }

      const validUsers = await ctx.call('users.find', {
        query: {_id: {$in: userIds}, isDeleted: false},
        fields: ['_id', 'fullName', 'email'],
      });

      const validUserIds = validUsers.map(u => u._id.toString());
      const invalidUserIds = userIds.filter(uid => !validUserIds.includes(uid));

      if (validUserIds.length === 0) {
        throw new MoleculerClientError('Không có học viên hợp lệ nào để gửi khóa học', 400);
      }

      const currentPublishedUsers = course.publishedToUsers || [];
      const currentUserIdSet = new Set(
        currentPublishedUsers
          .map(entry => {
            const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
            return uid;
          })
          .filter(Boolean),
      );

      const newUserIds = validUserIds.filter(uid => !currentUserIdSet.has(uid));
      const alreadyPublishedUserIds = validUserIds.filter(uid => currentUserIdSet.has(uid));

      const updatedEntries = currentPublishedUsers.map(entry => {
        const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
        if (uid && alreadyPublishedUserIds.includes(uid)) {
          return {userId: entry.userId, courseType: courseType};
        }
        return entry;
      });

      const newEntries = newUserIds.map(uid => ({userId: uid, courseType: courseType}));
      const finalPublishedUsers = [...updatedEntries, ...newEntries];

      await this.adapter.updateById(id, {
        $set: {publishedToUsers: finalPublishedUsers, updatedBy: user._id, updatedAt: now},
      });

      if (sendEmail && newUserIds.length > 0) {
        ctx.emit('course.users.added', {
          courseId: id,
          userIds: newUserIds,
          actorId: user._id,
          lang: ctx.meta.lang || 'vi',
        });
      }

      return {
        success: true,
        courseId: id,
        courseName: course.name,
        addedUsers: newUserIds,
        alreadyPublishedUsers: alreadyPublishedUserIds,
        failedUsers: invalidUserIds,
        courseTypeSet: courseType,
        emailSent: sendEmail && newUserIds.length > 0,
        message:
          newUserIds.length > 0
            ? `Đã gửi khóa học đến ${newUserIds.length} học viên mới với trạng thái ${courseType === 'mandatory' ? 'bắt buộc' : 'tùy chọn'}`
            : `Đã cập nhật trạng thái ${courseType === 'mandatory' ? 'bắt buộc' : 'tùy chọn'} cho ${alreadyPublishedUserIds.length} học viên`,
      };
    },
  },

  removeMembers: {
    rest: 'PUT /:id/remove-members',
    params: {
      id: {type: 'string'},
      userIds: {type: 'array', items: 'string', min: 1},
    },
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.UPDATE},
    async handler(ctx) {
      const {id, userIds} = ctx.params;
      const user = ctx.meta.user;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const course = await this.adapter.findById(id);
      if (!course || course.isDeleted) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }

      const isSystemAdmin = !!user.isSystemAdmin;

      const removedUserIds = [];
      const rejectedUsers = [];
      const notFoundUserIds = [];
      const cleanedUpSessionCounts = {};

      const currentPublishedUsers = course.publishedToUsers || [];
      const currentUserIdSet = new Set(
        currentPublishedUsers
          .map(entry => {
            const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
            return uid;
          })
          .filter(Boolean),
      );

      for (const uid of userIds) {
        if (!currentUserIdSet.has(uid)) {
          notFoundUserIds.push(uid);
          continue;
        }

        const sessions = await ctx.call('roleplaysessions.find', {
          query: {
            studentId: uid,
            courseId: id,
            isDeleted: {$ne: true},
            status: {$in: ['completed', 'analyzed']},
          },
          fields: ['_id'],
          limit: 1,
        });
        const hasSessions = sessions && sessions.length > 0;

        if (hasSessions && !isSystemAdmin) {
          let userName = uid;
          try {
            const userInfo = await ctx.call('users.get', {id: uid, fields: ['fullName', 'email']});
            userName = userInfo?.fullName || userInfo?.email || uid;
          } catch (e) {
            this.logger.warn(`Cannot get user info for ${uid}`, e);
          }
          rejectedUsers.push({
            userId: uid,
            userName,
            reason: 'Học viên đã tham gia phiên thực hành trong khóa học này. Không thể xóa.',
          });
        } else {
          removedUserIds.push(uid);
        }
      }

      if (removedUserIds.length > 0) {
        const removedSet = new Set(removedUserIds);
        const updatedPublishedUsers = currentPublishedUsers.filter(entry => {
          const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
          return !removedSet.has(uid);
        });

        await this.adapter.updateById(id, {
          $set: {
            publishedToUsers: updatedPublishedUsers,
            updatedBy: user._id,
            updatedAt: new Date(),
          },
        });

        for (const uid of removedUserIds) {
          try {
            const sessionCount = await this.cleanupMemberLearningHistory(ctx, id, uid);
            if (sessionCount > 0) {
              cleanedUpSessionCounts[uid] = sessionCount;
            }
          } catch (error) {
            this.logger.error(`Error cleaning up learning history for user ${uid} in course ${id}:`, error);
          }
        }
      }

      return {
        success: true,
        courseId: id,
        courseName: course.name,
        removedUserIds,
        rejectedUsers,
        notFoundUserIds,
        cleanedUpSessionCounts,
        message: this.buildRemoveMembersMessage(removedUserIds, rejectedUsers, cleanedUpSessionCounts),
      };
    },
  },

  // Thêm tài liệu tham khảo vào khóa học
  addReferenceToCourse: {
    rest: 'POST /:id/references/:referenceId',
    params: {
      id: {type: 'string'},
      referenceId: {type: 'string'},
    },
    async handler(ctx) {
      const {id, referenceId} = ctx.params;
      const user = ctx.meta.user;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const course = await this.adapter.findById(id);
      if (!course || course.isDeleted) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }

      const reference = await ctx.call('references.get', {id: referenceId}).catch(() => null);

      if (!reference) {
        throw new MoleculerClientError(
          i18next.t('error.reference_not_found', 'Không tìm thấy tài liệu tham khảo'),
          404,
        );
      }

      if (!course.references) {
        course.references = [];
      }
      if (!course.references.includes(referenceId)) {
        course.references.push(referenceId);
      }

      const updated = await this.adapter.updateById(id, {
        $set: {
          references: course.references,
          updatedBy: user._id,
          updatedAt: new Date(),
        },
      });

      return {success: true, reference, course: updated};
    },
  },

  // Xóa tài liệu tham khảo khỏi khóa học
  removeReferenceFromCourse: {
    rest: 'DELETE /:id/references/:referenceId',
    params: {
      id: {type: 'string'},
      referenceId: {type: 'string'},
    },
    async handler(ctx) {
      const {id, referenceId} = ctx.params;
      const user = ctx.meta.user;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const course = await this.adapter.findById(id);
      if (!course || course.isDeleted) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }
      
      if (course.references && course.references.includes(referenceId)) {
        course.references = course.references.filter(rId => rId.toString() !== referenceId);

        await this.adapter.updateById(id, {
          $set: {
            references: course.references,
            updatedBy: user._id,
            updatedAt: new Date(),
          },
        });
      }

      return {success: true, id, referenceId};
    },
  },
};