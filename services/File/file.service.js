const DbMongoose = require('../../mixins/dbMongo.mixin');
const FILE = require('./file.model');
const BaseService = require('../../mixins/baseService.mixin');
const FileMixin = require('../../mixins/file.mixin');
const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const path = require('path');
const fs = require('fs');
const {SERVICE_NAME} = require('./index');
const {USER_SERVICE} = require('../users');
const {ACCESS_CODE} = require('../../constants/constant');
const i18next = require('i18next');
const storageDir = path.join(__dirname, 'storage');
const {MoleculerClientError} = require('moleculer').Errors;
const thumbsupply = require('thumbsupply');
const {Poppler} = require('node-poppler');
const Tesseract = require('node-tesseract-ocr');
const gm = require('gm');
const carbone = require('carbone');
const util = require('util');
const {t} = require('i18next');
const wav = require('wav');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const config = {
  lang: 'eng',
  oem: 1,
  psm: 3,
};
const ffmpeg = require('fluent-ffmpeg');
const {getAudioDurationInSeconds} = require('get-audio-duration');
const pdf = require('pdf-parse');

module.exports = {
  name: SERVICE_NAME,
  mixins: [DbMongoose(FILE), BaseService, FileMixin, FunctionsCommon],
  settings: {
    populates: {
      ownerId: USER_SERVICE.get,
    },
    populateOptions: ['ownerId'],
  },

  hooks: {
    before: {},
  },

  actions: {
    list: {
      visibility: 'public',
    },
    upload: {
      async handler(ctx) {
        const {filename, userID, mimetype} = ctx.meta;
        const uniqueFileName = this.createUniqueFileName(filename);
        const {fileType, folder, userId, organizationId, used} = ctx.meta.$multipart;
        await this.save(ctx.params, uniqueFileName, folder);
        const filePath = this.getFilePath(uniqueFileName, this.getDirPath(folder, this.getStoragePath()));
        let stat = fs.statSync(filePath);

        const fileObject = {
          ownerId: userID,
          name: uniqueFileName,
          displayName: ctx.meta.displayName || filename,
          fileType: fileType,
          size: stat.size,
          mimetype: mimetype,
          storageType: 'local_storage',
          storageLocation: folder,
          used: used,
        };
        console.log('fileObject', fileObject);
        const file = await this.adapter.insert(fileObject);
        ctx.emit('fileUploaded', {file, userId, organizationId});
        return file;
      },
    },
    save: {
      auth: 'required',
      async handler(ctx) {
        const {filename, userID, fileType, mimetype, folder, used} = ctx.meta;
        const {userId, organizationId} = ctx.meta.$multipart;
        await this.save(ctx.params, filename, folder);
        const filePath = this.getFilePath(filename, this.getDirPath(folder, this.getStoragePath()));
        let stat = fs.statSync(filePath);

        const fileObject = {
          ownerId: userID,
          name: filename,
          displayName: ctx.meta.displayName || filename,
          size: stat.size,
          fileType: fileType,
          mimetype: mimetype,
          storageType: 'local_storage',
          storageLocation: folder,
          used: used,
        };
        const file = await this.adapter.insert(fileObject);
        if (!ctx.meta.bypassCapacityAddition) {
          ctx.emit('fileUploaded', {file, userId, organizationId});
        }
        return file;
      },
    },
    stream: {
      rest: 'GET /content/:id',
      // auth: "required",
      async handler(ctx) {
        try {
          const {id} = ctx.params;
          const file = await this.adapter.findById(id);
          if (!file) return new MoleculerClientError(i18next.t('error_data_not_found'), 404);
          const filePath = this.getFilePath(file.name, this.getDirPath(file.storageLocation, this.getStoragePath()));
          if (!fs.existsSync(filePath)) return new MoleculerClientError(i18next.t('error_file_not_found'), 404);
          let stat = fs.statSync(filePath);
          ctx.meta.$responseHeaders = {
            'Content-Type': file.mimetype,
            'Content-Length': stat.size,
            'Content-Disposition': 'attachment;filename=' + encodeURI(file.displayName || file.name),
          };
          return fs.createReadStream(filePath, {});
        } catch (e) {
          throw new MoleculerClientError(i18next.t('error_file_not_found'), 404);
        }
      },
    },

    url: {
      rest: 'GET /link/:id/image.png',
      async handler(ctx) {
        try {
          const {id} = ctx.params;
          const file = await this.adapter.findById(id);
          if (!file) return new MoleculerClientError(i18next.t('error_data_not_found'), 404);
          const filePath = this.getFilePath(file.name, this.getDirPath(file.storageLocation, this.getStoragePath()));
          if (!fs.existsSync(filePath)) return new MoleculerClientError(i18next.t('error_file_not_found'), 404);
          let stat = fs.statSync(filePath);
          ctx.meta.$responseHeaders = {
            'Content-Type': file.mimetype,
            'Content-Length': stat.size,
            'Content-Disposition': 'attachment;filename=' + encodeURI(file.displayName || file.name),
          };
          return fs.createReadStream(filePath, {});
        } catch (e) {
          throw new MoleculerClientError(i18next.t('error_file_not_found'), 404);
        }
      },
    },
    data: {
      auth: 'required',
      async handler(ctx) {
        try {
          const {id} = ctx.params;
          let file = await this.adapter.findById(id);
          if (!file) return new MoleculerClientError(i18next.t('error_file_not_found'), 404);
          const filePath = this.getFilePath(file.name, this.getDirPath(file.storageLocation, storageDir));
          if (!fs.existsSync(filePath)) return new MoleculerClientError(i18next.t('error_file_not_found'), 404);
          let stat = fs.statSync(filePath);
          ctx.meta.$responseHeaders = {
            'Content-Type': file.mimetype,
            'Content-Length': stat.size,
            'Content-Disposition': 'attachment;filename=' + encodeURI(file.displayName || file.name),
          };
          return fs.readFileSync(filePath);
        } catch (e) {
          throw new MoleculerClientError(i18next.t('error_file_not_found'), 404);
        }
      },
    },
    remove: {
      rest: 'DELETE /:id',
      auth: 'required',
      /** @param {Context} ctx */
      async handler(ctx) {
        try {
          const {id} = ctx.params;
          const file = await this.adapter.findById(id);
          if (!file) {
            return new MoleculerClientError(i18next.t('error_file_not_found'), 404);
          }
          const storagePath = this.getStoragePath();
          const dirPath = this.getDirPath(file.storageLocation, storagePath);
          const filePath = this.getFilePath(file.name, dirPath);

          if (!fs.existsSync(filePath)) {
            return new MoleculerClientError(i18next.t('error_file_not_found'), 404);
          }

          fs.unlinkSync(filePath);

          return await this.adapter.removeById(id);
        } catch (e) {
          throw new MoleculerClientError(i18next.t('error_file_not_found'), 404);
        }
      },
    },
    filePath: {
      rest: 'GET /:id/path',
      async handler(ctx) {
        try {
          const {id} = ctx.params;
          const file = await this.adapter.findById(id);

          if (!file) {
            return new MoleculerClientError(i18next.t('error_data_not_found'), 404);
          }

          const filePath = this.getFilePath(file.name, this.getDirPath(file.storageLocation, this.getStoragePath()));
          console.log('filePath', filePath);
          if (!fs.existsSync(filePath)) {
            return new MoleculerClientError(i18next.t('error_file_not_found'), 404);
          }

          return filePath;
        } catch (e) {
          console.log(e);
        }
      },
    },
    extractTextFromFile: {
      auth: 'required',
      async handler(ctx) {
        const {filename, mimetype, permission} = ctx.meta;
        const uniqueFileName = this.createUniqueFileName(filename);
        const {
          fileType,
          folder = 'office',
          firstPage,
          lastPage,
          userId,
          organizationId,
          totalPages,
        } = ctx.meta.$multipart;
        if (lastPage - firstPage > 25) throw new MoleculerClientError(i18next.t('large_page_range'), 400);
        const filePath = this.getFilePath(uniqueFileName, this.getDirPath(folder, this.getStoragePath()));
        await this.save(ctx.params, uniqueFileName, folder);

        const stat = fs.statSync(filePath);

        const ownerId = ctx.meta.user?._id;
        const displayName = ctx.meta.displayName || filename;
        const size = stat.size;
        const storageType = 'local_storage';
        const storageLocation = folder;

        const fileObject = {
          ownerId,
          name: uniqueFileName,
          displayName,
          fileType: fileType || 'file',
          size,
          mimetype: mimetype || 'text/plain',
          storageType,
          storageLocation,
        };

        const file = await this.adapter.insert(fileObject);
        ctx.emit('pdfUploaded', {file, userId, organizationId});
        ctx.emit('fileUploaded', {file, userId, organizationId});
        const extension = path.extname(uniqueFileName);

        const isDocFile = extension === '.docx' || extension === '.doc';
        const isPptFile = extension === '.ppt' || extension === '.pptx';
        const isTextFile = extension === '.txt' || extension === '.md';
        let fileToProcess = filePath;

        if (isTextFile) {
          fileToProcess = filePath;
          const text = await this.textFromTextFile(fileToProcess, uniqueFileName);
          file.texts.push({firstPage, lastPage, text: text.join(' ')});
        }

        if (isDocFile) {
          fileToProcess = await this.convertDocxToPDF(filePath);
        } else if (isPptFile) {
          fileToProcess = await this.convertPptToPDF(filePath);
        }

        const text = await this.textFromScannedPDF(fileToProcess, uniqueFileName, +firstPage, +lastPage, totalPages);
        file.texts.push({firstPage, lastPage, text: text.join(' ')});
        await this.adapter.updateById(file._id, file);
        return {file, text};
      },
    },

    prepareFileForExtraction: {
      async handler(ctx) {
        const {id, folder} = ctx.params;
        const file = await this.adapter.findById(id);
        if (!file) throw new MoleculerClientError(i18next.t('error_file_not_found'), 404);

        const filePath = this.getFilePath(file.name, this.getDirPath(folder, this.getStoragePath()));
        if (!fs.existsSync(filePath)) throw new MoleculerClientError(i18next.t('error_file_not_found'), 404);

        const extension = path.extname(file.name).toLowerCase();
        let pdfPath = filePath;

        if (extension === '.docx' || extension === '.doc') {
          pdfPath = await this.convertDocxToPDF(filePath);
        } else if (extension === '.ppt' || extension === '.pptx') {
          pdfPath = await this.convertPptToPDF(filePath);
        }

        const totalPages = await this.getPdfPageCount(pdfPath);
        return {totalPages, pdfPath};
      },
    },

    extractTextFromFileId: {
      rest: 'GET /:id/extractText',
      async handler(ctx) {
        try {
          const {id, firstPage, lastPage, totalPages, storageLocation, pdfPath} = ctx.params;
          const file = await this.adapter.findById(id);
          const cacheText = file.texts.find(text => text.firstPage === +firstPage && text.lastPage === +lastPage);
          if (cacheText) return {file, text: cacheText.text};

          const storagePath = this.getStoragePath();
          const dirPath = this.getDirPath(storageLocation || 'office', storagePath);
          const filePath = pdfPath || this.getFilePath(file.name, dirPath);

          const ext = path.extname(filePath).toLowerCase();

          let pdfFilePath = filePath;

          if (ext === '.docx') {
            pdfFilePath = await this.convertDocxToPDF(filePath);
          }
          if (ext === '.ppt' || ext === '.pptx') {
            pdfFilePath = await this.convertPptToPDF(filePath);
          }

          const text = await this.textFromScannedPDF(pdfFilePath, file.name, +firstPage, +lastPage, totalPages);
          file.texts.push({firstPage, lastPage, text: text.join(' ')});
          await this.adapter.updateById(file._id, file);
          return {file, text};
        } catch (e) {
          console.log(e);
        }
      },
    },
    extractTextFromPDFFile(filePath) {},

    extractTranscriptFromVideo: {
      auth: 'required',
      timeout: 10 * 60 * 1000, // 10 phút cho video dài
      async handler(ctx) {
        const { id, processWithAI = true } = ctx.params;

        const file = await this.adapter.findById(id);
        if (!file) {
          throw new MoleculerClientError(i18next.t('error_file_not_found'), 404);
        }

        if (!file.mimetype || !file.mimetype.startsWith('video/')) {
          throw new MoleculerClientError(i18next.t('only_video_files_are_supported'), 400, 'INVALID_FILE_TYPE');
        }

        // if (file.videoTranscript && file.videoTranscript.rawTranscript) {
        //   this.logger.info(`Returning cached transcript for ${file.name}`);
        //   let processedTranscript = file.videoTranscript.processedTranscript;
        //   if (processWithAI && !processedTranscript) {
        //     processedTranscript = await this.processTranscriptWithAI(ctx, file.videoTranscript.rawTranscript, file.displayName || file.name);
        //     await this.adapter.updateById(file._id, {
        //       $set: { 'videoTranscript.processedTranscript': processedTranscript },
        //     });
        //   }
        //   return {
        //     fileId: file._id,
        //     fileName: file.displayName || file.name,
        //     rawTranscript: file.videoTranscript.rawTranscript,
        //     processedTranscript: processedTranscript || file.videoTranscript.rawTranscript,
        //     duration: file.videoTranscript.duration,
        //     chunks: file.videoTranscript.chunks,
        //     cached: true,
        //   };
        // }

        const storagePath = this.getStoragePath();
        const filePath = this.getFilePath(file.name, this.getDirPath(file.storageLocation, storagePath));
        if (!fs.existsSync(filePath)) {
          throw new MoleculerClientError(i18next.t('error_file_not_found'), 404);
        }

        const tempDir = this.getDirPath('temp', storagePath);
        const fileName = path.basename(file.name, path.extname(file.name));
        const tempFilesToCleanup = [];

        try {
          const durationInSeconds = (await this.getVideoDuration(filePath)) || 0;

          const fullAudioPath = this.getFilePath(`${fileName}_full_audio_${Date.now()}.mp3`, tempDir);
          tempFilesToCleanup.push(fullAudioPath);
          await this.extractFullAudio(filePath, fullAudioPath);
          this.logger.info(`Full audio extracted: ${fullAudioPath}`);

          const chunkSize = 120; // 120s/chunk giảm 50% số lần gọi API so với 60s
          const totalChunks = Math.ceil(durationInSeconds / chunkSize) || 1;
          this.logger.info(`Processing video: ${file.name}, Duration: ${durationInSeconds}s, Chunks: ${totalChunks}`);

          const chunkTranscripts = new Array(totalChunks).fill('');
          const concurrencyLimit = 5;

          for (let i = 0; i < totalChunks; i += concurrencyLimit) {
            const batchSize = Math.min(concurrencyLimit, totalChunks - i);
            const batch = [];

            for (let j = 0; j < batchSize; j++) {
              const chunkIndex = i + j;
              batch.push((async () => {
                const start = chunkIndex * chunkSize;
                const end = Math.min((chunkIndex + 1) * chunkSize, durationInSeconds);
                const chunkDuration = end - start;
                if (chunkDuration <= 0) return;

                const mp3FilePath = this.getFilePath(`${fileName}_chunk_${chunkIndex}_${Date.now()}.mp3`, tempDir);
                tempFilesToCleanup.push(mp3FilePath);
                await this.cuttingAudioChunk(fullAudioPath, mp3FilePath, start, chunkDuration);

                const transcriptResult = await ctx.call('whisper.transcriptAudio', {
                  audioPath: mp3FilePath,
                });

                if (transcriptResult && transcriptResult.text) {
                  chunkTranscripts[chunkIndex] = transcriptResult.text;
                }

                try {
                  if (fs.existsSync(mp3FilePath)) fs.unlinkSync(mp3FilePath);
                } catch (e) { /* ignore cleanup error */ }

                this.logger.info(`Processed chunk ${chunkIndex + 1}/${totalChunks}`);
              })());
            }
            await Promise.allSettled(batch);
          }

          const rawTranscript = chunkTranscripts.filter(t => t).join(' ');

          let processedTranscript = rawTranscript;
          // if (processWithAI && rawTranscript) {
          //   processedTranscript = await this.processTranscriptWithAI(ctx, rawTranscript, file.displayName || file.name);
          // }
          //
          // // Cache transcript vào DB để lần sau không cần process lại
          // await this.adapter.updateById(file._id, {
          //   $set: {
          //     videoTranscript: {
          //       rawTranscript,
          //       processedTranscript: processWithAI ? processedTranscript : null,
          //       duration: durationInSeconds,
          //       chunks: totalChunks,
          //       extractedAt: new Date(),
          //     },
          //   },
          // });

          this.logger.info(`Transcript extraction completed for ${file.name}`);

          return {
            fileId: file._id,
            fileName: file.displayName || file.name,
            rawTranscript,
            processedTranscript,
            duration: durationInSeconds,
            chunks: totalChunks,
          };
        } catch (error) {
          this.logger.error('Failed to extract transcript from video:', error);
          throw new MoleculerClientError(
            `Error extracting transcript: ${error.message}`,
            500,
            'TRANSCRIPT_EXTRACTION_FAILED',
          );
        } finally {
          for (const tempFile of tempFilesToCleanup) {
            try {
              if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            } catch (e) { /* ignore cleanup error */ }
          }
        }
      },
    },

    extractTextFromUrl: {
      auth: 'required',
      async handler(ctx) {
        try {
          const {url, firstPage = 1, lastPage = 25, totalPages} = ctx.params;

          if (!url) {
            throw new MoleculerClientError(i18next.t('error.url_required', 'URL là bắt buộc'), 400);
          }

          // Chuyển đổi URL thành PDF
          const pdfPath = await this.convertUrlToPDF(url);

          // Trích xuất văn bản từ PDF
          const text = await this.textFromScannedPDF(
            pdfPath,
            `url_${this.getUniqueID()}.pdf`,
            +firstPage,
            +lastPage,
            totalPages,
          );

          // Tạo file record để lưu trữ
          const uniqueFileName = this.createUniqueFileName(`url_${this.getUniqueID()}.pdf`);
          const folder = 'url_pdf';
          const dirPath = this.getDirPath(folder, this.getStoragePath());
          const filePath = this.getFilePath(uniqueFileName, dirPath);

          // Copy file PDF đã tạo vào thư mục lưu trữ
          fs.copyFileSync(pdfPath, filePath);

          // Tạo file record trong database
          const fileObject = {
            ownerId: ctx.meta.user?._id,
            name: uniqueFileName,
            displayName: url.substring(0, 100) + '.pdf', // Sử dụng URL làm tên hiển thị
            fileType: 'pdf',
            size: fs.statSync(filePath).size,
            mimetype: 'application/pdf',
            storageType: 'local_storage',
            storageLocation: folder,
            texts: [{firstPage, lastPage, text: text.join(' ')}],
          };

          const file = await this.adapter.insert(fileObject);

          // Xóa file PDF tạm
          fs.unlinkSync(pdfPath);

          return {file, text};
        } catch (error) {
          throw new MoleculerClientError(
            `Error extracting text from URL: ${error.message}`,
            500,
            'URL_TEXT_EXTRACTION_ERROR',
          );
        }
      },
    },

    checkExists: {
      rest: 'GET /:id/exists',
      async handler(ctx) {
        try {
          const {id, folder} = ctx.params;
          const file = await this.adapter.findById(id);
          const filePath = this.getFilePath(file.name, this.getDirPath(folder, this.getStoragePath()));
          return fs.existsSync(filePath);
        } catch (e) {
          console.log(e);
        }
      },
    },

    getFileSize: {
      rest: 'GET /:id/size',
      async handler(ctx) {
        try {
          const {id} = ctx.params;
          const file = await this.adapter.findById(id);
          const filePath = this.getFilePath(file.name, this.getDirPath(file.storageLocation, this.getStoragePath()));

          return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
        } catch (e) {
          console.log(e);
        }
      },
    },
    videoStream: {
      rest: 'GET /video-stream/:id',
      auth: 'required',
      async handler(ctx) {
        const {range} = ctx.meta;
        if (!range) {
          throw new MoleculerClientError(i18next.t('range_header_is_required'), 400);
        }

        const {id} = ctx.params;
        const file = await this.adapter.findById(id);
        if (!file) {
          throw new MoleculerClientError(i18next.t('error_video_not_found'), 404);
        }

        const filePath = this.getFilePath(file.name, this.getDirPath(file.storageLocation, this.getStoragePath()));
        if (!fs.existsSync(filePath)) {
          throw new MoleculerClientError(i18next.t('error_video_not_found'), 404);
        }

        const videoSize = fs.statSync(filePath).size;
        const CHUNK_SIZE = 10 ** 6; // 1MB
        const start = Number(range.replace(/\D/g, ''));
        const end = Math.min(start + CHUNK_SIZE - 1, videoSize - 1);
        const contentLength = end - start + 1;

        const headers = {
          'Content-Range': `bytes ${start}-${end}/${videoSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': contentLength,
          'Content-Type': 'video/mp4',
        };

        ctx.meta.res.writeHead(206, headers);
        const readStream = fs.createReadStream(filePath, {start, end});
        readStream.pipe(ctx.meta.res);
      },
    },

    createThumbnailVideo: {
      async handler(ctx) {
        try {
          const userId = ctx.meta.user?._id;
          const {id} = ctx.params;
          const file = await this.adapter.findById(id);
          const filePath = this.getFilePath(file.name, this.getDirPath(file.storageLocation, this.getStoragePath()));
          const thumbnail = await this.generateThumbnailVideo(filePath);
          if (!fs.existsSync(thumbnail)) return null;
          const extension = path.extname(file.name);
          const fileName = path.basename(file.name, extension);
          const inStream = fs.createReadStream(thumbnail);
          const newPath = this.getFilePath(`${fileName}.png`, this.getDirPath('images', this.getStoragePath()));
          const thumbnailPath = this.getFilePath(
            `${fileName}_thumbnail.png`,
            this.getDirPath('images', this.getStoragePath()),
          );
          const outStream = fs.createWriteStream(newPath);
          inStream.pipe(outStream);

          const imageThumbnail = await this.thumbnail(ctx, newPath, thumbnailPath);
          fs.createReadStream(imageThumbnail);

          const fileObject = {
            ownerId: userId,
            name: `${fileName}_thumbnail.png`,
            displayName: `${fileName}.png`,
            fileType: 'image',
            mimetype: 'image/png',
            storageType: 'local_storage',
            storageLocation: 'images',
          };
          return await this.adapter.insert(fileObject);
        } catch (err) {
          console.log(err);
        }
      },
    },
    createFromAudioBuffer: {
      async handler(ctx) {
        try {
          const {buffer, folder} = ctx.params;
          const uniqueFileName = this.createUniqueFileName('text-to-speech.mp3');
          const userId = ctx.meta.user?._id;
          const organizationId = ctx.meta.user?.organizationId;
          const filePath = this.getFilePath(uniqueFileName, this.getDirPath(folder || 'audio', this.getStoragePath()));
          await fs.writeFileSync(filePath, buffer);
          let stat = fs.statSync(filePath);

          const fileObject = {
            ownerId: userId,
            name: uniqueFileName,
            displayName: ctx.meta.displayName || uniqueFileName,
            fileType: 'audio',
            size: stat.size,
            mimetype: 'audio/mpeg',
            storageType: 'local_storage',
            storageLocation: folder || 'audio',
          };
          const file = await this.adapter.insert(fileObject);
          ctx.emit('fileUploaded', {file, userId, organizationId});
          return file;
        } catch (e) {
          console.log(e);
        }
      },
    },
    createThumbnailPdf: {
      async handler(ctx) {
        try {
          const userId = ctx.meta.user?._id;
          const {id} = ctx.params;
          const file = await this.adapter.findById(id);
          const filePath = this.getFilePath(file.name, this.getDirPath(file.storageLocation, this.getStoragePath()));
          const extension = path.extname(file.name);
          const fileName = path.basename(file.name, extension);
          const thumbnailPath = this.getFilePath(
            `${fileName}_thumbnail.png`,
            this.getDirPath('images', this.getStoragePath()),
          );

          if (extension.includes('pdf')) {
            await this.generateThumbnailPdf(ctx, filePath, thumbnailPath);
          } else {
            await this.generateThumbnailDocx(ctx, filePath, thumbnailPath);
          }

          const fileObject = {
            ownerId: userId,
            name: `${fileName}_thumbnail.png`,
            displayName: `${fileName}.png`,
            fileType: 'image',
            mimetype: 'image/png',
            storageType: 'local_storage',
            storageLocation: 'images',
          };
          return await this.adapter.insert(fileObject);
        } catch (err) {
          console.log(err);
        }
      },
    },

    generateThumbnail: {
      async handler(ctx) {
        try {
          const {user} = ctx.meta;
          const {id, filePath} = ctx.params;

          let file = await this.adapter.findById(id);
          if (file) {
            ctx.call('files.remove', {id});
          }

          const uniqueFileName = `thumbnail_${this.getUniqueID()}.png`;
          file = await this.adapter.insert({
            ownerId: user._id,
            name: uniqueFileName,
            displayName: uniqueFileName,
            fileType: 'image',
            mimetype: 'image/png',
            storageType: 'local_storage',
            storageLocation: 'images',
          });

          const thumbnailPath = this.getFilePath(
            file.name,
            this.getDirPath(file.storageLocation, this.getStoragePath()),
          );

          if (filePath.includes('pdf')) {
            await this.generateThumbnailPdf(ctx, filePath, thumbnailPath);
          } else {
            await this.generateThumbnailDocx(ctx, filePath, thumbnailPath);
          }
          console.log(file);

          return file;
        } catch (err) {
          console.log(err);
        }
      },
    },

    createFileRecordAudio: {
      async handler(ctx) {
        try {
          const {audioChunks, fileName, userId} = ctx.params;
          //
          // const audioPath = this.getFilePath(fileName, this.getDirPath('audio', this.getStoragePath()));
          // const fileStream = fs.createWriteStream(audioPath);
          // const wavWriter = new wav.Writer({sampleRate: 16000, channels: 1, bitDepth: 16,});
          //
          // wavWriter.pipe(fileStream);
          //
          // audioChunks.forEach((chunk) => wavWriter.write(chunk));
          //
          // wavWriter.end(() => {
          //   console.log(`Audio file saved: ${audioPath}`);
          // });
          const wavPath = this.getFilePath(
            fileName.replace('.mp3', '.wav'),
            this.getDirPath('audio', this.getStoragePath()),
          );
          const mp3Path = this.getFilePath(fileName, this.getDirPath('audio', this.getStoragePath()));

          // Create a WAV file first
          const fileStream = fs.createWriteStream(wavPath);
          const wavWriter = new wav.Writer({sampleRate: 16000, channels: 1, bitDepth: 16});

          wavWriter.pipe(fileStream);
          audioChunks.forEach(chunk => wavWriter.write(chunk));
          wavWriter.end();

          await new Promise((resolve, reject) => {
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
          });

          // Convert WAV to MP3
          await new Promise((resolve, reject) => {
            ffmpeg(wavPath)
              .toFormat('mp3')
              .audioCodec('libmp3lame')
              .audioBitrate(128)
              .on('end', () => {
                console.log(`MP3 file saved: ${mp3Path}`);
                fs.unlinkSync(wavPath); // Delete WAV after conversion
                resolve();
              })
              .on('error', err => reject(err))
              .save(mp3Path);
          });
          const fileObject = {
            ownerId: userId,
            name: fileName,
            displayName: fileName,
            fileType: 'audio',
            mimetype: 'audio/mpeg',
            storageType: 'local_storage',
            storageLocation: 'audio',
          };
          return this.adapter.insert(fileObject);
        } catch (e) {
          console.log(e);
        }
      },
    },
    wordAudio: {
      rest: 'GET /wordAudio',
      async handler(ctx) {
        try {
          const {word} = ctx.params;

          const {speechKey, serviceRegion} = await this.broker.call('settings.findOne');
          const voice = 'en-US-AndrewMultilingualNeural';
          const wordPath = this.getFilePath(
            `${word}_${voice}.wav`,
            this.getDirPath('wordAudio', this.getStoragePath()),
          );
          const speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, serviceRegion);
          speechConfig.speechSynthesisLanguage = 'en-US';
          speechConfig.speechSynthesisVoiceName = voice;

          const audioConfig = sdk.AudioConfig.fromAudioFileOutput(wordPath);
          const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);
          if (!fs.existsSync(wordPath)) {
            let stat = fs.statSync(wordPath);
            ctx.meta.$responseHeaders = {
              'Content-Type': 'audio/wav',
              'Content-Length': stat.size,
              'Content-Disposition': `attachment;filename=${word}.wav`,
            };
            return fs.createReadStream(wordPath, {});
          }
          await synthesizer.speakTextAsync(
            word,
            result => {
              synthesizer.close();
              let stat = fs.statSync(wordPath);
              ctx.meta.$responseHeaders = {
                'Content-Type': 'audio/wav',
                'Content-Length': stat.size,
                'Content-Disposition': `attachment;filename=${word}.wav`,
              };
              return fs.createReadStream(wordPath, {});
            },
            err => {
              synthesizer.close();
              if (err) {
                console.log(err);
                return null;
              }
            },
          );
        } catch (e) {
          console.log(e);
        }
      },
    },
    wordPath: {
      rest: 'GET /:word/path',
      async handler(ctx) {
        try {
          const {word} = ctx.params;

          const voice = 'en-US-AndrewMultilingualNeural';
          const wordPath = this.getFilePath(
            `${word}_${voice}.wav`,
            this.getDirPath('wordAudio', this.getStoragePath()),
          );
          if (!fs.existsSync(wordPath)) {
            return new MoleculerClientError(i18next.t('error_data_not_found'), 404);
          }
          return wordPath;
        } catch (e) {
          console.log(e);
        }
      },
    },
    pathFromFileName: {
      rest: 'GET /:fileName/path',
      async handler(ctx) {
        const {fileName} = ctx.params;
        const filePath = this.getFilePath(fileName, this.getDirPath('audio', this.getStoragePath()));
        if (!fs.existsSync(filePath)) {
          return new MoleculerClientError(i18next.t('error_data_not_found'), 404);
        }
        return filePath;
      },
    },
    getAudioDuration: {
      rest: 'GET /:id/duration',
      async handler(ctx) {
        const {id} = ctx.params;
        const file = await this.adapter.findById(id);
        const filePath = this.getFilePath(file.name, this.getDirPath(file.storageLocation, this.getStoragePath()));
        if (!fs.existsSync(filePath)) {
          return 0;
        }
        return getAudioDurationInSeconds(filePath);
      },
    },
    createAudioSessionFile: {
      // visibility: "public", // Hoặc "protected" nếu cần xác thực
      async handler(ctx) {
        const {audioChunks, userId, baseOutputFileName, clientAudioFormat, storageFolder} = ctx.params;
        if (!audioChunks || audioChunks.length === 0) {
          throw new MoleculerClientError('Audio chunks are required.', 400, 'AUDIO_CHUNKS_REQUIRED');
        }
        if (!userId || !baseOutputFileName || !clientAudioFormat || !storageFolder) {
          throw new MoleculerClientError(
            'Missing required parameters (userId, baseOutputFileName, clientAudioFormat, storageFolder).',
            400,
            'MISSING_PARAMS',
          );
        }

        const wavFileName = `${baseOutputFileName}.wav`;
        const mp3FileName = `${baseOutputFileName}.mp3`;

        const wavFilePath = this.getFilePath(wavFileName, this.getDirPath(storageFolder, this.getStoragePath()));
        const mp3FilePath = this.getFilePath(mp3FileName, this.getDirPath(storageFolder, this.getStoragePath()));

        try {
          // 1. Tạo và ghi file WAV
          const combinedAudioBuffer = Buffer.concat(audioChunks.map(chunk => Buffer.from(chunk))); // Đảm bảo là buffer
          const fileStream = fs.createWriteStream(wavFilePath);
          const wavWriter = new wav.Writer({
            sampleRate: clientAudioFormat.sampleRate || 16000,
            channels: clientAudioFormat.channels || 1,
            bitDepth: clientAudioFormat.bitDepth || 16,
          });

          wavWriter.pipe(fileStream);
          wavWriter.write(combinedAudioBuffer);
          wavWriter.end();

          await new Promise((resolve, reject) => {
            fileStream.on('finish', resolve);
            fileStream.on('error', err => {
              this.logger.error(`Lỗi khi ghi file WAV ${wavFilePath} trong file.service:`, err);
              reject(new MoleculerClientError(`Failed to write WAV file: ${err.message}`, 500, 'WAV_WRITE_FAILED'));
            });
          });
          this.logger.info(`File WAV (từ audio session) đã lưu: ${wavFilePath}`);

          // 2. Chuyển đổi WAV sang MP3
          const targetMp3SampleRate = 16000;
          const targetMp3Channels = 1;
          await new Promise((resolve, reject) => {
            ffmpeg(wavFilePath)
              .toFormat('mp3')
              .audioCodec('libmp3lame')
              .audioBitrate(128)
              .audioFrequency(targetMp3SampleRate)
              .audioChannels(targetMp3Channels)
              .on('end', () => {
                this.logger.info(`File MP3 (từ audio session) đã lưu: ${mp3FilePath}`);
                if (fs.existsSync(wavFilePath)) {
                  fs.unlink(wavFilePath, errUnlink => {
                    if (errUnlink)
                      this.logger.warn(
                        `Lỗi khi xóa file WAV ${wavFilePath} sau khi chuyển đổi (file.service):`,
                        errUnlink,
                      );
                  });
                }
                resolve();
              })
              .on('error', err => {
                this.logger.error(`Lỗi khi chuyển đổi WAV sang MP3 cho ${wavFilePath} (file.service):`, err);
                reject(
                  new MoleculerClientError(
                    `Failed to convert WAV to MP3: ${err.message}`,
                    500,
                    'MP3_CONVERSION_FAILED',
                  ),
                );
              })
              .save(mp3FilePath);
          });

          // 3. Tạo bản ghi file MP3 trong cơ sở dữ liệu
          const mp3Buffer = fs.readFileSync(mp3FilePath);
          const fileDataForDb = {
            ownerId: userId,
            name: mp3FileName,
            displayName: mp3FileName,
            fileType: 'audio',
            mimetype: 'audio/mpeg',
            storageType: 'local_storage',
            storageLocation: storageFolder,
            size: mp3Buffer.length,
            used: true,
          };

          // Sử dụng this.adapter.insert trực tiếp vì chúng ta đang ở trong file.service
          const fileEntity = await this.adapter.insert(fileDataForDb);
          this.logger.info(
            `Bản ghi file MP3 (từ audio session) đã lưu vào DB với ID: ${fileEntity._id} (file.service)`,
          );

          // Không xóa mp3FilePath vì đó là file chính thức

          return fileEntity; // Trả về entity file đã tạo
        } catch (error) {
          this.logger.error(`Lỗi trong createAudioSessionFile (file.service) cho ${baseOutputFileName}:`, error);
          // Dọn dẹp file tạm nếu có lỗi xảy ra
          if (fs.existsSync(wavFilePath)) {
            try {
              fs.unlinkSync(wavFilePath);
            } catch (unlinkErr) {
              this.logger.warn(`Lỗi khi dọn dẹp WAV ${wavFilePath} trong catch (file.service):`, unlinkErr);
            }
          }
          if (fs.existsSync(mp3FilePath)) {
            // Cân nhắc việc xóa mp3FilePath nếu quá trình tạo bản ghi DB thất bại
            try {
              // fs.unlinkSync(mp3FilePath); // Nếu fileEntity chưa được tạo thành công thì có thể xóa
            } catch (unlinkErr) {
              this.logger.warn(`Lỗi khi dọn dẹp MP3 ${mp3FilePath} trong catch (file.service):`, unlinkErr);
            }
          }
          if (error instanceof MoleculerClientError) throw error;
          throw new MoleculerClientError(
            `Error processing audio session file: ${error.message}`,
            500,
            'AUDIO_SESSION_PROCESSING_ERROR',
          );
        }
      },
    },
    createVideoSessionFile: {
      async handler(ctx) {
        const { videoBuffer, userId, baseOutputFileName, storageFolder, mimetype } = ctx.params;
        if (!videoBuffer || videoBuffer.length === 0) {
          throw new MoleculerClientError('Video buffer is required.', 400, 'VIDEO_BUFFER_REQUIRED');
        }
        if (!userId || !baseOutputFileName || !storageFolder) {
          throw new MoleculerClientError(
            'Missing required parameters (userId, baseOutputFileName, storageFolder).',
            400,
            'MISSING_PARAMS',
          );
        }

        const videoFileName = `${baseOutputFileName}.webm`;
        const videoFilePath = this.getFilePath(videoFileName, this.getDirPath(storageFolder, this.getStoragePath()));

        try {
          // Ghi video buffer vào file
          const buffer = Buffer.from(videoBuffer);
          fs.writeFileSync(videoFilePath, buffer);
          this.logger.info(`Video file saved: ${videoFilePath}`);

          const stat = fs.statSync(videoFilePath);

          // Tạo bản ghi file trong cơ sở dữ liệu
          const fileDataForDb = {
            ownerId: userId,
            name: videoFileName,
            displayName: videoFileName,
            fileType: 'video',
            mimetype: mimetype || 'video/webm',
            storageType: 'local_storage',
            storageLocation: storageFolder,
            size: stat.size,
            used: true,
          };

          const fileEntity = await this.adapter.insert(fileDataForDb);
          this.logger.info(
            `Video file record saved to DB with ID: ${fileEntity._id}`,
          );

          return fileEntity;
        } catch (error) {
          this.logger.error(`Error in createVideoSessionFile for ${baseOutputFileName}:`, error);
          // Dọn dẹp file nếu có lỗi
          if (fs.existsSync(videoFilePath)) {
            try {
              fs.unlinkSync(videoFilePath);
            } catch (unlinkErr) {
              this.logger.warn(`Error cleaning up video file ${videoFilePath}:`, unlinkErr);
            }
          }
          if (error instanceof MoleculerClientError) throw error;
          throw new MoleculerClientError(
            `Error processing video session file: ${error.message}`,
            500,
            'VIDEO_SESSION_PROCESSING_ERROR',
          );
        }
      },
    },

    /**
     * Upload video roleplay session qua multipart stream.
     * Pattern giống action upload nhưng chuyên cho video roleplay.
     * Nhận file stream qua ctx.params, metadata qua ctx.meta.$multipart.
     */
    uploadRoleplayVideo: {
      async handler(ctx) {
        const {filename, userID, mimetype} = ctx.meta;
        const uniqueFileName = this.createUniqueFileName(filename);
        const {fileType, folder, userId, used} = ctx.meta.$multipart;
        await this.save(ctx.params, uniqueFileName, folder);
        const filePath = this.getFilePath(uniqueFileName, this.getDirPath(folder, this.getStoragePath()));
        let stat = fs.statSync(filePath);

        const fileObject = {
          ownerId: userID || userId,
          name: uniqueFileName,
          displayName: filename,
          fileType: fileType || 'video',
          size: stat.size,
          mimetype: mimetype || 'video/webm',
          storageType: 'local_storage',
          storageLocation: folder,
          used: used !== undefined ? used : true,
        };
        this.logger.info('[uploadRoleplayVideo] Saving file record:', fileObject.name, 'size:', stat.size);
        const file = await this.adapter.insert(fileObject);
        return file;
      },
    },
  },
  methods: {
    async timeout(delay) {
      return new Promise(res => setTimeout(res, delay));
    },
    async convertDocxToPDF(inputFilePath) {
      const fileBuffer = fs.readFileSync(inputFilePath);
      const options = {
        convertTo: 'pdf',
        extension: 'docx',
      };
      const outPDFPath = this.getFilePath(
        `fileconvert_${this.getUniqueID()}.pdf`,
        this.getDirPath('convert', storageDir),
      );

      return new Promise((resolve, reject) => {
        carbone.convert(fileBuffer, options, function (err, result) {
          if (err) return reject(err);
          fs.writeFileSync(outPDFPath, result);
          resolve(outPDFPath);
        });
      });
    },

    async convertPptToPDF(inputFilePath) {
      const fileBuffer = fs.readFileSync(inputFilePath);
      const extension = path.extname(inputFilePath).toLowerCase();
      const options = {
        convertTo: 'pdf',
        extension: extension === '.pptx' ? 'pptx' : 'ppt',
      };
      const outPDFPath = this.getFilePath(
        `fileconvert_${this.getUniqueID()}.pdf`,
        this.getDirPath('convert', storageDir),
      );

      return new Promise((resolve, reject) => {
        carbone.convert(fileBuffer, options, function (err, result) {
          if (err) return reject(err);
          fs.writeFileSync(outPDFPath, result);
          resolve(outPDFPath);
        });
      });
    },

    async convertUrlToPDF(url) {
      try {
        const puppeteer = require('puppeteer');
        const browser = await puppeteer.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const page = await browser.newPage();
        await page.goto(url, {waitUntil: 'networkidle2', timeout: 60000});

        const outPDFPath = this.getFilePath(
          `urlconvert_${this.getUniqueID()}.pdf`,
          this.getDirPath('convert', storageDir),
        );

        await page.pdf({path: outPDFPath, format: 'A4'});
        await browser.close();

        return outPDFPath;
      } catch (error) {
        throw new Error(`Error converting URL to PDF: ${error.message}`);
      }
    },
    thumbnail(ctx, filePath, outputFilePath) {
      let width = 480,
        height = 262,
        align = 'center';
      return new Promise((resolve, reject) => {
        gm(filePath)
          // .autoOrient() theo issues #2919
          .thumb(width, height, outputFilePath, 80, align, null, err => {
            console.log(err);
            if (err) {
              reject(err);
            } else {
              resolve(outputFilePath);
            }
          });
      });
    },

    async textFromTextFile(filePath, uniqueFileName) {
      try {
        const text = fs.readFileSync(filePath, 'utf8');
        return text.split('\n');
      } catch (error) {
        throw new Error(`Error reading text file ${uniqueFileName}: ${error.message}`);
      }
    },

    async textFromScannedPDF(pdfPath, filename, firstPage, last, pages) {
      try {
        console.log('pdfPath', pdfPath);
        const poppler = new Poppler();
        const uniqueID = this.getUniqueID();
        const imageDir = this.getDirPath('scanned_images', this.getStoragePath());
        const imagePath = this.getFilePath(uniqueID, imageDir);
        const totalPages = pages || (await this.getPdfPageCount(pdfPath));
        const lastPage = last && last < totalPages ? last : totalPages;
        const pageLength = String(totalPages).length || 1;

        const options = {
          firstPageToConvert: firstPage,
          lastPageToConvert: lastPage,
          pngFile: true,
        };
        const result = await poppler.pdfToCairo(pdfPath, imagePath, options);
        const promises = Array.from({length: lastPage - firstPage + 1}, (_, i) => {
          const page = String(firstPage + i).padStart(pageLength, '0');
          const imagePath = this.getFilePath(`${uniqueID}-${page}.png`, imageDir);
          return this.textFromImageByChatGPT(imagePath);
        });

        return await Promise.allSettled(promises);
      } catch (error) {
        throw new Error(`Something went wrong while trying to extract text from a scanned PDF: ${error.message}`);
      }
    },

    async textFromImage(filePath) {
      const text = await Tesseract.recognize(filePath, config);
      fs.unlinkSync(filePath);
      return text;
    },
    async textFromImageByChatGPT(filePath) {
      try {
        const imageBuffer = fs.readFileSync(filePath);
        const messages = [
          {
            role: 'user',
            content: 'Get the text in the image',
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
                  detail: 'high',
                },
              },
            ],
          },
          {
            role: 'user',
            content:
              "Return only text in the image. If you don't have a text in the image, just return an empty string.",
          },
        ];

        return await this.broker.call(`tools.submitFastLLM`, {
          messages,
          responseFormat: 'markdown',
          temperature: '0.3',
          max_tokens: 2000,
        });
      } catch (error) {
        console.log(error);
        return '';
      }
    },

    async checkAccess(ctx) {
      const {workspaceId, fileSize} = ctx.meta.$multipart;
      let permission;
      let organizationId = ctx.meta.$multipart.organizationId;
      let userId = ctx.meta.$multipart.userId;
      if (workspaceId) {
        const workspace = await ctx.call('workspaces.get', {id: workspaceId});
        ({organizationId, userId} = workspace);
      }
      ctx.meta.$multipart = {...ctx.meta.$multipart, organizationId, userId};
      permission = await ctx.call('permissions.getOne', {organizationId, userId});
      if (
        permission &&
        +permission.accessLimit?.capacityUsed + fileSize / (1024 * 1024) > +permission.accessLimit?.capacityLimit
      ) {
        throw new MoleculerClientError(i18next.t('capacity_exceeded'), 405, 'FORBIDDEN');
      }

      if (permission && permission.accessLimit?.capacityUsed >= +permission.accessLimit?.capacityLimit) {
        throw new MoleculerClientError(i18next.t('upgrade_your_plan'), 406);
      }
    },
    getStoragePath() {
      return storageDir;
    },
    async save(stream, filename, folder) {
      const dirPath = this.getDirPath(folder, this.getStoragePath());
      const filePath = this.getFilePath(filename, dirPath);
      return this.saveToLocalStorage(stream, filePath);
    },

    async generateThumbnailVideo(filePath) {
      return await thumbsupply.generateThumbnail(filePath, {
        size: thumbsupply.ThumbSize.LARGE, // Specify thumbnail size
        timestamp: '10%', // Specify the timestamp (e.g., 10% of video length)
        forceCreate: true, // Generate the thumbnail every time
        mimetype: 'video/mp4', // Specify the video format
      });
    },
    async generateThumbnailPdf(ctx, inputPath, outputPath) {
      let width = 156,
        height = 190,
        align = 'top';
      return new Promise((resolve, reject) => {
        gm(inputPath)
          // .autoOrient() theo issues #2919
          .thumb(width, height, outputPath, 80, align, null, err => {
            if (err) {
              console.log(err);
              reject(err);
            } else {
              resolve(outputPath);
            }
          });
      });
    },
    async generateThumbnailDocx(ctx, inputPath, outputPath) {
      const convertAsync = util.promisify(carbone.convert);
      try {
        const dataBuffer = await fs.promises.readFile(inputPath);
        const options = {
          convertTo: 'pdf',
          extension: 'docx',
        };
        const result = await convertAsync(dataBuffer, options);
        await this.generateThumbnailPdf(ctx, result, outputPath);
      } catch (err) {
        console.error(err);
      }
    },
    async getPdfPageCount(pdfPath) {
      const buffer = fs.readFileSync(pdfPath);
      const data = await pdf(buffer);
      return data.numpages;
    },

    async getVideoDuration(filePath) {
      return new Promise((resolve, reject) => {
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

    async extractFullAudio(videoPath, outputPath) {
      return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .noVideo()
          .audioCodec('libmp3lame')
          .audioBitrate(64) // bitrate thấp cho speech transcript, giảm file size
          .audioChannels(1) // mono cho speech
          .audioFrequency(16000) // 16kHz đủ cho speech recognition
          .toFormat('mp3')
          .on('error', (error) => {
            this.logger.error('Extract full audio failed:', error.message);
            reject(error);
          })
          .on('end', () => {
            resolve(outputPath);
          })
          .saveToFile(outputPath);
      });
    },

    async cuttingAudioChunk(audioPath, outputPath, startSeconds, duration) {
      return new Promise((resolve, reject) => {
        ffmpeg(audioPath)
          .setStartTime(startSeconds)
          .setDuration(duration)
          .audioCodec('copy')
          .on('error', (error) => {
            this.logger.error('Cutting audio chunk failed:', error.message);
            reject(error);
          })
          .on('end', () => {
            resolve(outputPath);
          })
          .saveToFile(outputPath);
      });
    },

    async processTranscriptWithAI(ctx, transcript, videoTitle) {
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
        const { apiKey, model, endpoint } = defaultModelData;
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
        this.logger.error(`Failed to process transcript with AI: ${error.message}`);
        return null;
      }
    },
  },
  events: {
    jobClearFileStudentUpload: {
      async handler(ctx) {
        const files = await this.adapter.find({query: {used: false}});
        const fileIds = files.map(file => file._id);
        await Promise.all(fileIds.map(id => this.actions.remove({id})));
      },
    },
  },

  async started() {
    this.createFolderIfNotExist(storageDir);
  },
  stopped() {},
};
