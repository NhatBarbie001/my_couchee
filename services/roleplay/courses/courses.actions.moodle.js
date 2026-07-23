'use strict';

const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const {RESOURCES, ACTIONS} = require('../../../constants/permissions');
const {MoodleClient} = require('../../moodle/moodle');

/**
 * Courses Service - Moodle Actions
 * Contains: getMoodleCourses, getMoodleCourseCategories, getDetailMoodleCourses,
 *           getContentsMoodleCourses, getAssignmentsMoodleCourses,
 *           getMoodleReferences, getReferencesByMoodleCoursesId,
 *           createReferenceFromMoodle
 */

module.exports = {
  getMoodleCourses: {
    rest: 'GET /moodle',
    params: {},
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.VIEW},
    async handler(ctx) {
      const user = ctx.meta.user;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      try {
        const moodleSettings = await this.getMoodleSettings();
        const moodleClient = new MoodleClient(moodleSettings.baseUrl, moodleSettings.moodleToken);
        const categories = await moodleClient.getCourseCategories();
        const courses = await moodleClient.getCourses();

        const coursesWithCategory = courses.map(course => {
          const category = categories.find(c => c.id === course.categoryid);
          return {...course, categoryname: category?.name};
        });

        const courseExistsMoodle = await this.broker.call('courses.find', {
          query: {
            moodleCourseId: {$exists: true},
            isDeleted: {$ne: true},
          },
        });
        const newCourses = coursesWithCategory.filter(
          course => !courseExistsMoodle.some(c => c.moodleCourseId === course.id),
        );
        return {
          success: true,
          courses: newCourses || [],
          total: newCourses?.length || 0,
        };
      } catch (error) {
        this.logger.error('Error fetching Moodle courses:', error);
        throw new MoleculerClientError(
          error.message || i18next.t('error.moodle_fetch_failed', 'Không thể lấy danh sách khóa học từ Moodle'),
          error.code || 500,
        );
      }
    },
  },

  getMoodleCourseCategories: {
    rest: 'GET /moodle/categories',
    async handler(ctx) {
      const user = ctx.meta.user;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }
      try {
        const moodleSettings = await this.getMoodleSettings();
        const moodleClient = new MoodleClient(moodleSettings.baseUrl, moodleSettings.moodleToken);
        const categories = await moodleClient.getCourseCategories();

        return {
          success: true,
          categories,
        };
      } catch (error) {
        this.logger.error('Error fetching Moodle course categories:', error);
        throw new MoleculerClientError(
          error.message ||
            i18next.t('error.moodle_fetch_failed', 'Không thể lấy danh sách danh mục khóa học từ Moodle'),
          error.code || 500,
        );
      }
    },
  },

  getDetailMoodleCourses: {
    rest: 'GET /moodle/:courseId/details',
    params: {},
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.VIEW},
    async handler(ctx) {
      const user = ctx.meta.user;
      const {courseId} = ctx.params;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      try {
        const moodleSettings = await this.getMoodleSettings();
        const moodleClient = new MoodleClient(moodleSettings.baseUrl, moodleSettings.moodleToken);

        const courseDetails = await moodleClient.getCourseById(courseId);

        return {
          success: true,
          course: courseDetails || {},
        };
      } catch (error) {
        this.logger.error('Error fetching Moodle course details:', error);
        throw new MoleculerClientError(
          error.message || i18next.t('error.moodle_fetch_failed', 'Không thể lấy chi tiết khóa học từ Moodle'),
          error.code || 500,
        );
      }
    },
  },

  getContentsMoodleCourses: {
    rest: 'GET /moodle/:courseId/contents',
    params: {},
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.VIEW},
    async handler(ctx) {
      const user = ctx.meta.user;
      const {courseId} = ctx.params;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      try {
        const moodleSettings = await this.getMoodleSettings();
        const moodleClient = new MoodleClient(moodleSettings.baseUrl, moodleSettings.moodleToken);

        const courseContents = await moodleClient.getCourseContents(courseId);

        return {
          success: true,
          course: courseContents || {},
        };
      } catch (error) {
        this.logger.error('Error fetching Moodle course contents:', error);
        throw new MoleculerClientError(
          error.message || i18next.t('error.moodle_fetch_failed', 'Không thể lấy nội dung khóa học từ Moodle'),
          error.code || 500,
        );
      }
    },
  },

  getAssignmentsMoodleCourses: {
    rest: 'GET /moodle/:courseId/assignments',
    params: {},
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.VIEW},
    async handler(ctx) {
      const user = ctx.meta.user;
      const {courseId} = ctx.params;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      try {
        const moodleSettings = await this.getMoodleSettings();
        const moodleClient = new MoodleClient(moodleSettings.baseUrl, moodleSettings.moodleToken);

        const assignments = await moodleClient.getAssignments(courseId);
        const aiScenarios = await this.broker.call('aiscenarios.find', {
          query: {
            moodleAssignmentId: {$exists: true},
            isDeleted: {$ne: true},
          },
        });
        const newAssignments = assignments.filter(
          assignment => !aiScenarios.some(a => a.moodleAssignmentId === assignment.id),
        );
        return newAssignments || [];
      } catch (error) {
        this.logger.error('Error fetching Moodle course contents:', error);
        throw new MoleculerClientError(
          error.message || i18next.t('error.moodle_fetch_failed', 'Không thể lấy nội dung khóa học từ Moodle'),
          error.code || 500,
        );
      }
    },
  },

  getMoodleReferences: {
    rest: 'GET /:id/moodle/references',
    params: {
      id: {type: 'string'},
    },
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.VIEW},
    async handler(ctx) {
      const user = ctx.meta.user;
      const {id} = ctx.params;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const course = await this.adapter.findById(id);
      if (!course || course.isDeleted) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }

      if (!course.moodleCourseId) {
        throw new MoleculerClientError('Khóa học này không liên kết với Moodle', 400);
      }

      try {
        const moodleSettings = await this.getMoodleSettings();
        const moodleClient = new MoodleClient(moodleSettings.baseUrl, moodleSettings.moodleToken);

        const courseContents = await moodleClient.getCourseContents(course.moodleCourseId);

        const references = [];

        if (courseContents && Array.isArray(courseContents)) {
          for (const section of courseContents) {
            if (section.modules && Array.isArray(section.modules)) {
              for (const module of section.modules) {
                if (module.modname === 'url' || module.modname === 'resource') {
                  const referenceData = {
                    id: module.id,
                    name: module.name,
                    modname: module.modname,
                    url: module.fileurl || null,
                    description: module.description || null,
                    section: {
                      id: section.id,
                      name: section.name,
                    },
                  };

                  if (module.contents && module.contents.length > 0) {
                    referenceData.fileurl = module.contents[0].fileurl;
                    referenceData.filename = module.contents[0].filename;
                    referenceData.filesize = module.contents[0].filesize;
                    referenceData.mimetype = module.contents[0].mimetype;
                  }

                  references.push(referenceData);
                }
              }
            }
          }
        }

        return references;
      } catch (error) {
        this.logger.error('Error fetching Moodle references:', error);
        throw new MoleculerClientError(
          error.message || 'Không thể lấy danh sách tài liệu tham khảo từ Moodle',
          error.code || 500,
        );
      }
    },
  },

  getReferencesByMoodleCoursesId: {
    rest: 'GET /moodle/:moodleCourseId/references',
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.VIEW},
    async handler(ctx) {
      const user = ctx.meta.user;
      const {moodleCourseId} = ctx.params;
      if (!moodleCourseId) {
        throw new MoleculerClientError('Không thể lấy danh sách tài liệu tham khảo từ Moodle', 400);
      }

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }
      try {
        const moodleSettings = await this.getMoodleSettings();
        const moodleClient = new MoodleClient(moodleSettings.baseUrl, moodleSettings.moodleToken);

        const courseContents = await moodleClient.getCourseContents(moodleCourseId);

        const references = [];

        if (courseContents && Array.isArray(courseContents)) {
          for (const section of courseContents) {
            if (section.modules && Array.isArray(section.modules)) {
              for (const module of section.modules) {
                if (module.modname === 'url' || module.modname === 'resource') {
                  const referenceData = {
                    id: module.id,
                    name: module.name,
                    modname: module.modname,
                    url: module.fileurl || null,
                    description: module.description || null,
                    section: {
                      id: section.id,
                      name: section.name,
                    },
                  };

                  if (module.contents && module.contents.length > 0) {
                    referenceData.fileurl = module.contents[0].fileurl;
                    referenceData.filename = module.contents[0].filename;
                    referenceData.filesize = module.contents[0].filesize;
                    referenceData.mimetype = module.contents[0].mimetype;
                  }

                  references.push(referenceData);
                }
              }
            }
          }
        }

        return references;
      } catch (error) {
        this.logger.error('Error fetching Moodle references:', error);
        throw new MoleculerClientError(
          error.message || 'Không thể lấy danh sách tài liệu tham khảo từ Moodle',
          error.code || 500,
        );
      }
    },
  },

  createReferenceFromMoodle: {
    rest: 'POST /:id/moodle/references',
    params: {
      id: {type: 'string'},
      modname: {type: 'string', enum: ['url', 'resource']},
      name: {type: 'string', optional: true},
      fileurl: {type: 'string', optional: true},
      filename: {type: 'string', optional: true},
      mimetype: {type: 'string', optional: true},
    },
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.UPDATE},
    async handler(ctx) {
      const user = ctx.meta.user;
      const {id, modname, url, name, fileurl, filename, mimetype, isPublic, aiReadable} = ctx.params;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const course = await this.adapter.findById(id);
      if (!course || course.isDeleted) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }

      if (!course.moodleCourseId) {
        throw new MoleculerClientError('Khóa học này không liên kết với Moodle', 400);
      }

      try {
        let reference;
        if (modname === 'url') {
          if (!fileurl) {
            throw new MoleculerClientError('URL là bắt buộc cho loại tài liệu URL', 400);
          }

          let referenceType = 'url';
          if (fileurl.includes('youtube.com') || fileurl.includes('youtu.be')) {
            referenceType = 'youtube';
          }

          reference = await ctx.call('references.create', {
            name: name || filename,
            type: referenceType,
            url: fileurl,
            courseId: id.toString(),
            isPublic,
            aiReadable,
          });
        } else if (modname === 'resource') {
          if (!fileurl || !filename) {
            throw new MoleculerClientError('File URL và filename là bắt buộc cho loại tài liệu resource', 400);
          }

          const extension = filename.split('.').pop().toLowerCase();
          let referenceType = 'docs';
          let fileId = null;
          let content = null;

          if (['mp4', 'avi', 'mov', 'wmv'].includes(extension)) {
            referenceType = 'video';
          } else if (['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension)) {
            referenceType = 'docs';
          } else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(extension)) {
            referenceType = 'image';
          } else if (['mp3', 'wav', 'ogg', 'flac'].includes(extension)) {
            referenceType = 'audio';
          }

          const downloadedFile = await this.downloadFileFromMoodle(fileurl, filename, mimetype, user._id);
          console.log('downloadedFile', downloadedFile);
          fileId = downloadedFile._id;

          if (referenceType === 'docs') {
            try {
              const {file, text} = await ctx.call('files.extractTextFromFileId', {
                id: fileId,
                firstPage: 1,
                lastPage: 25,
                storageLocation: 'roleplay/references',
              });
              if (text && Array.isArray(text)) {
                content = text.map(t => t.value).join('\n');
              }
            } catch (error) {
              this.logger.error('Error extracting text from PDF:', error);
            }
          }

          const referenceData = {
            name: filename,
            type: referenceType,
            fileId: fileId,
            courseId: id.toString(),
            content: content,
            createdBy: user._id,
            updatedBy: user._id,
            isPublic,
            aiReadable,
          };

          reference = await ctx.call('references.create', referenceData);
        } else {
          throw new MoleculerClientError('Loại tài liệu không hợp lệ', 400);
        }
        return reference;
      } catch (error) {
        this.logger.error('Error creating reference from Moodle:', error);
        throw new MoleculerClientError(
          error.message || 'Không thể tạo tài liệu tham khảo từ Moodle',
          error.code || 500,
        );
      }
    },
  },
};