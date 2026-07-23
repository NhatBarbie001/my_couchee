'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const FileMixin = require('../../../mixins/file.mixin');
const Model = require('./references.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;

module.exports = {
  name: 'references',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService, FileMixin],

  settings: {
    entityValidator: {
      type: {type: 'string', enum: ['video', 'youtube', 'docs', 'image', 'url', 'audio']},
      fileId: {type: 'string', optional: true},
      url: {type: 'string', optional: true},
      content: {type: 'string', optional: true},
    },
    populates: {
      fileId: 'files.get',
      organizationId: 'organizations.get',
      createdBy: 'users.get',
      updatedBy: 'users.get',
    },
    populateOptions: ['fileId', 'organizationId', 'createdBy', 'updatedBy'],
    fields: [
      '_id',
      'name',
      'type',
      'fileId',
      'url',
      'content',
      'isPublic',
      'aiReadable',
      'organizationId',
      'createdBy',
      'updatedBy',
      'createdAt',
      'updatedAt',
      'isDeleted',
      'aiSummary',
      'status',
    ],
  },

  hooks: {
    after: {
      create: async (ctx, reference) => {
        ctx.emit('references.created', {reference});
        return reference;
      },
      remove: async (ctx, reference) => {
        ctx.emit('references.deleted', {reference});
        return reference;
      },
    },
  },

  dependencies: ['files', 'organizations', 'users'],

  actions: {
    create: {
      rest: 'POST /',
      params: {
        name: {type: 'string'},
        type: {type: 'string', optional: true},
        fileId: {type: 'string', optional: true},
        url: {type: 'string', optional: true},
        content: {type: 'string', optional: true},
        organizationId: {type: 'string', optional: true},
        courseId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {
          name,
          type: providedType,
          fileId,
          url,
          content,
          organizationId,
          courseId,
          aiReadable,
          isPublic,
        } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        let file = null;
        if (fileId) {
          file = await ctx.call('files.get', {id: fileId}).catch(() => null);

          if (!file) {
            throw new MoleculerClientError(i18next.t('error.file_not_found', 'File không tồn tại'), 404);
          }
        }

        let type = providedType;
        if (!type) {
          if (url && !fileId) {
            if (url.includes('youtube.com') || url.includes('youtu.be')) {
              type = 'youtube';
            } else {
              type = 'url';
            }
          } else if (fileId && !url) {
            if (file && file.filename) {
              const extension = file.filename.split('.').pop().toLowerCase();
              console.log('extension', extension);

              if (extension === 'pdf') {
                type = 'pdf';
              } else if (extension === 'pptx' || extension === 'ppt') {
                type = 'pptx';
              } else {
                type = 'docs';
              }
            } else {
              type = 'docs';
            }
          } else {
            throw new MoleculerClientError(
              i18next.t('error.type_required', 'Không thể tự động xác định loại tài liệu, vui lòng cung cấp type'),
              400,
            );
          }
        }

        if (type === 'url' && !url) {
          throw new MoleculerClientError(i18next.t('error.url_required', 'URL là bắt buộc cho loại tài liệu URL'), 400);
        }

        if ((type === 'pdf' || type === 'pptx' || type === 'docs') && !fileId) {
          throw new MoleculerClientError(
            i18next.t('error.file_required', 'File là bắt buộc cho loại tài liệu này'),
            400,
          );
        }

        if (type === 'youtube' && !url) {
          throw new MoleculerClientError(
            i18next.t('error.youtube_url_required', 'URL YouTube là bắt buộc cho loại tài liệu YouTube'),
            400,
          );
        }

        let existingReference = null;
        if ((type === 'url' || type === 'youtube') && url) {
          existingReference = await this.adapter.findOne(
            {
              url,
              type,
              content: {$exists: true, $ne: null},
            },
            {
              sort: {createdAt: 1}, // hoặc updatedAt: 1
            },
          );

          if (existingReference && courseId && existingReference.content) {
            try {
              await ctx.call('references.update', {
                id: existingReference._id.toString(),
                isPublic,
                aiReadable,
              });

              await ctx.call('courses.addReferenceToCourse', {
                id: courseId,
                referenceId: existingReference._id.toString(),
              });

              return this.transformDocuments(ctx, {}, existingReference);
            } catch (error) {
              this.logger.error(`Failed to add existing reference to course: ${error.message}`);
            }
          }
        }

        const referenceData = {
          name,
          type,
          fileId,
          url,
          content,
          aiReadable,
          isPublic,
          status: content ? 'completed' : 'pending',
          organizationId: organizationId || user.organizationId,
          createdBy: user._id,
          updatedBy: user._id,
        };

        let videoDetail = null;
        if (type === 'youtube') {
          videoDetail = await ctx.call('videos.videoDetail', {url: url});
          referenceData.name = videoDetail.title;
        }

        let reference = await this.adapter.insert(referenceData);

        if (reference.type === 'url' && reference.url) {
          try {
            const {file, text} = await ctx.call('files.extractTextFromUrl', {
              url: reference.url,
              firstPage: 1,
              lastPage: 25,
            });

            const extractedContent = Array.isArray(text) ? text.map(t => t.value).join('\n') : null;
            reference = await this.adapter.updateById(reference._id, {
              $set: {
                fileId: file._id.toString(),
                content: extractedContent,
                updatedAt: new Date(),
              },
            });

            // AI tóm tắt content (async, không block response)
            if (extractedContent) {
              this.generateAISummary(ctx, reference._id, extractedContent, reference.name);
            }

            this.logger.info(`Extracted content from URL ${reference.url} for reference ${reference._id}`);
          } catch (error) {
            this.logger.error(`Failed to extract content from URL ${reference.url}: ${error.message}`);
          }
        }

        if (reference.type === 'youtube' && reference.url) {
          try {
            const cutStart = 0;
            const cutEnd = videoDetail.lengthSeconds || 0;
            const transcript = await ctx.call('videos.videoTranscript', {
              url: reference.url,
              cutStart: cutStart,
              cutEnd: cutEnd,
            });

            if (transcript && typeof transcript === 'string' && transcript.trim() !== '') {
              const processedTranscript = await this.processTranscriptWithOpenAI(ctx, transcript, videoDetail.title);

              const finalContent = processedTranscript || transcript;
              reference = await this.adapter.updateById(reference._id, {
                $set: {
                  content: finalContent,
                  updatedAt: new Date(),
                },
              });

              if (finalContent) {
                this.generateAISummary(ctx, reference._id, finalContent, reference.name);
              }
            }
          } catch (error) {
            this.logger.error(`Failed to fetch transcript for YouTube video ${reference.url}: ${error.message}`);
          }
        }
        // console.log(reference);
        this.broker.emit('references.created', {reference, user});

        if (courseId) {
          try {
            await ctx.call('courses.addReferenceToCourse', {
              id: courseId,
              referenceId: reference._id.toString(),
            });
            this.logger.info(`Added reference ${reference._id} to course ${courseId}`);
          } catch (error) {
            this.logger.error(`Failed to add reference to course: ${error.message}`);
          }
        }

        return this.transformDocuments(ctx, {}, reference);
      },
    },

    update: {
      rest: 'PUT /:id',
      params: {
        id: {type: 'string'},
        type: {type: 'string', enum: ['video', 'youtube', 'docs', 'image', 'url', 'audio'], optional: true},
        fileId: {type: 'string', optional: true},
        url: {type: 'string', optional: true},
        content: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {id, ...updateData} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const reference = await this.adapter.findById(id);
        if (!reference || reference.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.reference_not_found', 'Không tìm thấy tài liệu tham khảo'),
            404,
          );
        }

        if (updateData.fileId) {
          const file = await ctx.call('files.get', {id: updateData.fileId}).catch(() => null);

          if (!file) {
            throw new MoleculerClientError(i18next.t('error.file_not_found', 'File không tồn tại'), 404);
          }
        }

        const type = updateData.type || reference.type;

        if (type === 'url' && updateData.hasOwnProperty('url') && !updateData.url) {
          throw new MoleculerClientError(i18next.t('error.url_required', 'URL là bắt buộc cho loại tài liệu URL'), 400);
        }

        if (
          (type === 'video' || type === 'docs' || type === 'image' || type === 'audio') &&
          updateData.hasOwnProperty('fileId') &&
          !updateData.fileId
        ) {
          throw new MoleculerClientError(
            i18next.t('error.file_required', 'File là bắt buộc cho loại tài liệu này'),
            400,
          );
        }

        if (type === 'youtube' && updateData.hasOwnProperty('url') && !updateData.url) {
          throw new MoleculerClientError(
            i18next.t('error.youtube_url_required', 'URL YouTube là bắt buộc cho loại tài liệu YouTube'),
            400,
          );
        }

        const allowedUpdates = ['name', 'type', 'fileId', 'url', 'content', 'isPublic', 'aiReadable'];
        const finalUpdateData = {};

        for (const key of allowedUpdates) {
          if (updateData.hasOwnProperty(key)) {
            finalUpdateData[key] = updateData[key];
          }
        }

        finalUpdateData.updatedBy = user._id;
        finalUpdateData.updatedAt = new Date();

        const updated = await this.adapter.updateById(id, {$set: finalUpdateData});
        this.broker.emit('references.updated', {reference: updated, user});
        return this.transformDocuments(ctx, {}, updated);
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

        const reference = await this.adapter.findById(id);
        if (!reference || reference.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.reference_not_found', 'Không tìm thấy tài liệu tham khảo'),
            404,
          );
        }

        const hasPermission = user.isSystemAdmin || user.type === 'teacher';

        if (!hasPermission) {
          throw new MoleculerClientError(
            i18next.t('error.permission_denied', 'Bạn không có quyền xóa tài liệu tham khảo này'),
            403,
          );
        }

        // Kiểm tra xem có courses nào đang dùng reference này không
        const courses = await ctx.call('courses.find', {
          query: {
            references: id,
            isDeleted: false,
          },
        });

        if (courses && courses.length > 0) {
          throw new MoleculerClientError(
            i18next.t('error.reference_in_use_courses', 'Không thể xóa tài liệu tham khảo vì đang được sử dụng bởi {{count}} khóa học', { count: courses.length }),
            400,
            'REFERENCE_IN_USE',
          );
        }

        // Kiểm tra xem có scenarios nào đang dùng reference này không
        const scenarios = await ctx.call('aiscenarios.find', {
          query: {
            references: id,
            isDeleted: false,
          },
        });

        if (scenarios && scenarios.length > 0) {
          throw new MoleculerClientError(
            i18next.t('error.reference_in_use_scenarios', 'Không thể xóa tài liệu tham khảo vì đang được sử dụng bởi {{count}} kịch bản', { count: scenarios.length }),
            400,
            'REFERENCE_IN_USE',
          );
        }

        const updated = await this.adapter.updateById(id, {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            updatedBy: user._id,
          },
        });

        this.broker.emit('references.deleted', {referenceId: id, user});
        return {success: true, id};
      },
    },

    uploadAndCreate: {
      async handler(ctx) {
        const {name, organizationId, courseId, url, isPublic, aiReadable} = ctx.meta.$multipart;
        const user = ctx.meta.user;
        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        ctx.meta.$multipart = ctx.meta.$multipart || {};
        const referenceObject = {
          organizationId: organizationId || user.organizationId,
          createdBy: user._id,
          updatedBy: user._id,
        };

        let fileId = null;
        let reference = null;
        let type = null;

        if (!type && ctx.meta.filename) {
          const fileExtension = ctx.meta.filename.split('.').pop().toLowerCase();
          if (fileExtension === 'pdf') {
            type = 'pdf';
          } else if (fileExtension === 'pptx' || fileExtension === 'ppt') {
            type = 'pptx';
          } else if (
            fileExtension === 'mp4' ||
            fileExtension === 'webm' ||
            fileExtension === 'mp3' ||
            fileExtension === 'wav'
          ) {
            type = 'video';
          } else {
            type = 'docs';
          }
        }
        let content = null;
        if (ctx.meta.filename) {
          switch (type) {
            case 'pdf': {
              ctx.meta.$multipart.folder = 'roleplay/references';
              ctx.meta.$multipart.firstPage = 1;
              ctx.meta.$multipart.lastPage = 10; // pdf thường nhiều trang hơn

              const {file, text} = await ctx.call('files.extractTextFromFile', ctx.params, {meta: ctx.meta});

              fileId = file._id.toString();
              content = text?.map(t => t.value).join('\n');

              break;
            }

            case 'pptx': {
              ctx.meta.$multipart.folder = 'roleplay/references';
              ctx.meta.$multipart.firstPage = 1;
              ctx.meta.$multipart.lastPage = 20; // pptx có nhiều slide

              const {file, text} = await ctx.call('files.extractTextFromFile', ctx.params, {meta: ctx.meta});

              fileId = file._id.toString();
              content = text?.map(t => t.value).join('\n');

              break;
            }

            case 'docs':
            default: {
              ctx.meta.$multipart.folder = 'roleplay/references';
              ctx.meta.$multipart.firstPage = 1;
              ctx.meta.$multipart.lastPage = 5;

              const {file, text} = await ctx.call('files.extractTextFromFile', ctx.params, {meta: ctx.meta});

              console.log(file, text);

              fileId = file._id.toString();
              content = text?.map(t => t.value).join('\n');

              console.log('CONTENT', content);

              break;
            }

            case 'video': {
              ctx.meta.$multipart.folder = 'roleplay/references';

              const file = await ctx.call('files.upload', ctx.params, {meta: ctx.meta});
              fileId = file._id.toString();

              // Call File Service to extract transcript
              const transcriptResult = await ctx.call('files.extractTranscriptFromVideo', {
                id: file._id,
                processWithAI: true,
              });

              content = transcriptResult?.processedTranscript || transcriptResult?.rawTranscript;

              break;
            }
          }
        }

        const referenceData = {
          name: name || ctx.meta.filename || 'Untitled Reference',
          type,
          fileId,
          url,
          content,
          isPublic,
          aiReadable,
          organizationId: organizationId || user.organizationId,
          createdBy: user._id,
          updatedBy: user._id,
        };

        reference = await this.adapter.insert(referenceData);

        if (content) {
          this.generateAISummary(ctx, reference._id, content, reference.name);
        }

        this.broker.emit('references.created', {reference, user});
        if (courseId) {
          try {
            await ctx.call('courses.addReferenceToCourse', {
              id: courseId,
              referenceId: reference._id.toString(),
            });
            this.logger.info(`Added reference ${reference._id} to course ${courseId}`);
          } catch (error) {
            this.logger.error(`Failed to add reference to course: ${error.message}`);
          }
        }

        return this.transformDocuments(ctx, { populate: this.settings.populateOptions }, reference);
      },
    },

    uploadFile: {
      async handler(ctx) {
        const user = ctx.meta.user;
        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const {name, organizationId, courseId, url, isPublic, aiReadable} = ctx.meta.$multipart || {};

        // Xử lý trường hợp có file upload
        let fileId = null;
        let detectedType = null;

        if (ctx.meta.filename) {
          // Auto detect type từ extension
          const fileExtension = ctx.meta.filename.split('.').pop().toLowerCase();
          detectedType = 'docs';
          if (fileExtension === 'pdf') {
            detectedType = 'pdf';
          } else if (fileExtension === 'pptx' || fileExtension === 'ppt') {
            detectedType = 'pptx';
          } else if (['mp4', 'webm', 'mp3', 'wav'].includes(fileExtension)) {
            detectedType = 'video';
          }

          ctx.meta.$multipart = ctx.meta.$multipart || {};
          ctx.meta.$multipart.folder = 'roleplay/references';

          const file = await ctx.call('files.upload', ctx.params, {meta: ctx.meta});
          fileId = file._id.toString();
        }

        let type = detectedType;
        if (!type && url) {
          if (url.includes('youtube.com') || url.includes('youtu.be')) {
            type = 'youtube';
          } else {
            type = 'url';
          }
        }

        if (!type) {
          throw new MoleculerClientError(
            i18next.t('error.type_required', 'Không thể xác định loại tài liệu, vui lòng cung cấp file hoặc url'),
            400,
          );
        }

        const referenceData = {
          name: name || ctx.meta.filename || 'Untitled Reference',
          type,
          fileId,
          url: url || null,
          content: null,
          isPublic: isPublic === 'true' || isPublic === true,
          aiReadable: aiReadable === 'true' || aiReadable === true,
          status: 'pending',
          organizationId: organizationId || user.organizationId,
          createdBy: user._id,
          updatedBy: user._id,
        };

        if (type === 'youtube' && url) {
          try {
            const videoDetail = await ctx.call('videos.videoDetail', {url});
            if (videoDetail?.title) {
              referenceData.name = videoDetail.title;
            }
          } catch (error) {
            this.logger.warn(`Failed to get YouTube video detail: ${error.message}`);
          }
        }

        const reference = await this.adapter.insert(referenceData);

        this.broker.emit('references.created', {reference, user});

        if (courseId) {
          try {
            await ctx.call('courses.addReferenceToCourse', {
              id: courseId,
              referenceId: reference._id.toString(),
            });
            this.logger.info(`Added reference ${reference._id} to course ${courseId}`);
          } catch (error) {
            this.logger.error(`Failed to add reference to course: ${error.message}`);
          }
        }

        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, reference);
      },
    },

    processContent: {
      rest: 'POST /:id/process',
      params: {
        id: {type: 'string'},
      },
      timeout: 10 * 60 * 1000, // 10 phút cho video dài
      async handler(ctx) {
        const {id} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const reference = await this.adapter.findById(id);
        if (!reference || reference.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.reference_not_found', 'Không tìm thấy tài liệu tham khảo'),
            404,
          );
        }

        if (reference.status === 'completed' && reference.content) {
          return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, reference);
        }

        await this.adapter.updateById(id, {
          $set: {status: 'processing', updatedAt: new Date()},
        });

        try {
          let content = null;
          const type = reference.type;

          if (reference.fileId) {
            const file = await ctx.call('files.get', {id: reference.fileId.toString()}).catch(() => null);

            if (!file) {
              throw new MoleculerClientError(
                i18next.t('error.file_not_found', 'File không tồn tại'),
                404,
              );
            }

            switch (type) {
              case 'pdf': {
                const result = await ctx.call('files.extractTextFromFileId', {
                  id: reference.fileId.toString(),
                  firstPage: 1,
                  lastPage: 10,
                  storageLocation: file.storageLocation,
                });
                content = Array.isArray(result?.text)
                  ? result.text.map(t => t.value).join('\n')
                  : typeof result?.text === 'string' ? result.text : null;
                break;
              }

              case 'pptx': {
                const result = await ctx.call('files.extractTextFromFileId', {
                  id: reference.fileId.toString(),
                  firstPage: 1,
                  lastPage: 20,
                  storageLocation: file.storageLocation,
                });
                content = Array.isArray(result?.text)
                  ? result.text.map(t => t.value).join('\n')
                  : typeof result?.text === 'string' ? result.text : null;
                break;
              }

              case 'video': {
                const transcriptResult = await ctx.call('files.extractTranscriptFromVideo', {
                  id: file._id,
                  processWithAI: true,
                });
                content = transcriptResult?.processedTranscript || transcriptResult?.rawTranscript;
                break;
              }

              case 'docs':
              default: {
                const result = await ctx.call('files.extractTextFromFileId', {
                  id: reference.fileId.toString(),
                  firstPage: 1,
                  lastPage: 5,
                  storageLocation: file.storageLocation,
                });
                content = Array.isArray(result?.text)
                  ? result.text.map(t => t.value).join('\n')
                  : typeof result?.text === 'string' ? result.text : null;
                break;
              }
            }
          } else if (reference.url) {
            if (type === 'url') {
              const {file, text} = await ctx.call('files.extractTextFromUrl', {
                url: reference.url,
                firstPage: 1,
                lastPage: 25,
              });

              content = Array.isArray(text) ? text.map(t => t.value).join('\n') : null;

              if (file?._id) {
                await this.adapter.updateById(id, {
                  $set: {fileId: file._id.toString()},
                });
              }
            } else if (type === 'youtube') {
              const videoDetail = await ctx.call('videos.videoDetail', {url: reference.url});
              const cutStart = 0;
              const cutEnd = videoDetail?.lengthSeconds || 0;

              const transcript = await ctx.call('videos.videoTranscript', {
                url: reference.url,
                cutStart,
                cutEnd,
              });

              if (transcript && typeof transcript === 'string' && transcript.trim() !== '') {
                const processedTranscript = await this.processTranscriptWithOpenAI(
                  ctx, transcript, videoDetail.title,
                );
                content = processedTranscript || transcript;
              }
            }
          }

          const updated = await this.adapter.updateById(id, {
            $set: {
              content: content || null,
              status: 'completed',
              updatedAt: new Date(),
              updatedBy: user._id,
            },
          });

          if (content) {
            this.generateAISummary(ctx, reference._id, content, reference.name);
          }

          this.broker.emit('references.contentProcessed', {reference: updated, user});
          return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, updated);

        } catch (error) {
          this.logger.error(`Failed to process content for reference ${id}: ${error.message}`);

          await this.adapter.updateById(id, {
            $set: {
              status: 'failed',
              updatedAt: new Date(),
            },
          });

          throw new MoleculerClientError(
            `Xử lý nội dung thất bại: ${error.message}`,
            500,
          );
        }
      },
    },
  },

  events: {
    'references.created': {
      async handler(payload) {
        this.logger.info(`New reference created: ${payload.reference.name}`);
      },
    },

    'references.updated': {
      async handler(payload) {
        this.logger.info(`Reference updated: ${payload.reference._id}`);
      },
    },

    'references.deleted': {
      async handler(payload) {
        this.logger.info(`Reference deleted: ${payload.referenceId}`);
      },
    },
  },

  methods: {
    /**
     * @deprecated Use files.extractTranscriptFromVideo action instead
     * This method is kept for backward compatibility only
     */
    async extractTranscriptFromVideo(ctx, file) {
      this.logger.warn('extractTranscriptFromVideo is deprecated. Use files.extractTranscriptFromVideo instead.');
      try {
        const result = await ctx.call('files.extractTranscriptFromVideo', {
          id: file._id,
          processWithAI: true,
        });
        return result?.processedTranscript || result?.rawTranscript;
      } catch (error) {
        this.logger.error('Failed to extract transcript from video:', error);
        return null;
      }
    },

    /**
     * @deprecated Use files.getVideoDuration method instead
     */
    async getVideoDuration(filePath) {
      this.logger.warn('getVideoDuration is deprecated. Use files.getVideoDuration instead.');
      return new Promise((resolve, reject) => {
        const ffmpeg = require('fluent-ffmpeg');
        const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
        const ffprobePath = require('@ffprobe-installer/ffprobe').path;

        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobePath);

        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) {
            reject(err);
          } else {
            const duration = metadata.format.duration;
            resolve(duration);
          }
        });
      });
    },

    /**
     * @deprecated Use files.processTranscriptWithAI method instead
     */
    async processTranscriptWithOpenAI(ctx, transcript, videoTitle) {
      this.logger.warn('processTranscriptWithOpenAI is deprecated. Use files.processTranscriptWithAI instead.');
      try {
        const messages = [
          {
            role: 'system',
            content:
              'Bạn là một trợ lý AI chuyên xử lý và cải thiện chất lượng transcript. Nhiệm vụ của bạn là:' +
              '\n1. Sửa lỗi chính tả, ngữ pháp trong transcript' +
              '\n2. Định dạng lại transcript để dễ đọc hơn' +
              '\n3. Loại bỏ các từ lặp lại, từ đệm không cần thiết' +
              '\n4. Giữ nguyên nội dung và thông tin và ví dụ của transcript' +
              '\n5. Tổ chức thành các đoạn có ý nghĩa' +
              '\nKhông thêm nội dung mới hoặc diễn giải lại nội dung.' +
              '\nLưu ý: highlight các tiêu đề và gạch đầu dòng.' +
              '\nĐặc biệt là không thêm các title chẳng hạn như: "Dưới đây là transcript đã được xử lý và cải thiện chất lượng theo yêu cầu:". Thay vào đó trả về trực tiếp transcript đã được xử lý và cải thiện.',
          },
          {
            role: 'user',
            content: `Đây là transcript của video có tiêu đề "${videoTitle}". Hãy xử lý và cải thiện chất lượng transcript này:\n\n${transcript}`,
          },
        ];

        const defaultModelData = await ctx.call('llmsmodel.getDefaultModel');
        const {apiKey, model, endpoint} = defaultModelData;
        const modelInterface = defaultModelData?.modelInterface || 'AzureOpenAI';

        const processedTranscript = await ctx.call(
          modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
          {
            messages,
            model,
            temperature: 0.3,
            max_tokens: 6000,
            apiKey,
            endpoint,
          },
        );

        return processedTranscript;
      } catch (error) {
        this.logger.error(`Failed to process transcript with OpenAI: ${error.message}`);
        return null;
      }
    },

    async generateAISummary(ctx, referenceId, content, referenceName) {
      try {
        const truncatedContent = content.length > 8000 ? content.substring(0, 8000) + '...' : content;

        const messages = [
          {
            role: 'system',
            content:
              'Bạn là một trợ lý AI chuyên tóm tắt nội dung tài liệu. Nhiệm vụ của bạn là:' +
              '\n1. Tóm tắt nội dung chính của tài liệu một cách ngắn gọn, súc tích' +
              '\n2. Nêu bật các điểm quan trọng, ý chính và thông tin cốt lõi' +
              '\n3. Giữ bản tóm tắt trong khoảng 200-500 từ' +
              '\n4. Sử dụng ngôn ngữ rõ ràng, dễ hiểu' +
              '\n5. Nếu tài liệu có cấu trúc (tiêu đề, mục), tóm tắt theo cấu trúc đó' +
              '\nTrả về trực tiếp bản tóm tắt, không thêm tiêu đề mở đầu.',
          },
          {
            role: 'user',
            content: `Hãy tóm tắt nội dung tài liệu "${referenceName || 'Không có tên'}" sau đây:\n\n${truncatedContent}`,
          },
        ];

        const defaultModelData = await ctx.call('llmsmodel.getDefaultModel');
        const {apiKey, model, endpoint} = defaultModelData;
        const modelInterface = defaultModelData?.modelInterface || 'AzureOpenAI';

        const aiSummary = await ctx.call(
          modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
          {
            messages,
            model,
            temperature: 0.3,
            max_tokens: 2000,
            apiKey,
            endpoint,
          },
        );

        if (aiSummary) {
          await this.adapter.updateById(referenceId, {
            $set: {
              aiSummary,
              updatedAt: new Date(),
            },
          });
          this.logger.info(`AI summary generated for reference ${referenceId}`);
        }
      } catch (error) {
        this.logger.error(`Failed to generate AI summary for reference ${referenceId}: ${error.message}`);
      }
    },
  },

  async started() {
    this.logger.warn('#####################################################References service started');
  },

  async stopped() {
    this.logger.warn('#####################################################References service stopped');
  },
};
