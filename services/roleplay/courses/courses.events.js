'use strict';

/**
 * Courses Service - Event Handlers
 * Contains event handlers for: references.created, references.updated, references.deleted,
 *                               course.users.added, roleplay.analysis.completed
 */

module.exports = {
  'references.created': {
    async handler(payload) {
      this.logger.info(`New reference created: ${payload.reference._id}`);
    },
  },

  'references.updated': {
    async handler(payload) {
      this.logger.info(`Reference updated: ${payload.reference._id}`);
    },
  },

  'references.deleted': {
    async handler(payload) {
      if (payload.reference) {
        const referenceId = payload.reference._id || payload.referenceId;

        const courses = await this.adapter.find({
          query: {
            references: referenceId,
            isDeleted: {$ne: true},
          },
        });

        for (const course of courses) {
          course.references = course.references.filter(id => id.toString() !== referenceId.toString());

          await this.adapter.updateById(course._id, {
            $set: {
              references: course.references,
              updatedAt: new Date(),
            },
          });

          this.logger.info(`Removed reference ${referenceId} from course ${course._id}`);
        }
      }
    },
  },

  'course.users.added': {
    async handler(payload) {
      await this.broker.call(
        'courses.sendEmailToStudents',
        {
          id: payload.courseId,
          userIds: payload.userIds,
        },
        {
          meta: {
            user: payload.actor,
            lang: payload.lang,
          },
        },
      );
    },
  },

  'roleplay.analysis.completed': {
    async handler(payload) {
      const {sessionId} = payload;
      if (!sessionId) return;

      try {
        const session = await this.broker.call('roleplaysessions.get', {id: sessionId}).catch(() => null);
        if (!session || !session.courseId) return;

        const courseId = session.courseId?._id?.toString() || session.courseId?.toString();
        if (!courseId) return;

        const course = await this.adapter.findById(courseId);
        if (!course || course.isDeleted || course.status !== 'published') return;

        const isFullyCompleted = await this.checkCourseFullyCompleted(null, course);
        if (isFullyCompleted) {
          await this.adapter.updateById(courseId, {
            $set: {status: 'completed'},
          });
          this.logger.info(
            `Khóa học ${courseId} đã được cập nhật trạng thái thành 'completed' (tất cả học viên hoàn thành 100%)`,
          );
        }
      } catch (error) {
        this.logger.error(`Lỗi khi kiểm tra hoàn thành khóa học sau analysis:`, error);
      }
    },
  },
};