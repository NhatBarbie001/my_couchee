"use strict";

const FunctionsCommon = require("../../mixins/functionsCommon.mixin");
const FileMixin = require("../../mixins/file.mixin");
const Model = require("./offlineVideos.model");
const DbMongoose = require("../../mixins/dbMongo.mixin");
const path = require("path");
const storageDir = path.join(__dirname, "storage");
const { USER_CODES } = require("../../constants/constant");

const { FILE_SERVICE } = require("../File");
const fs = require("fs");
const
  ffmpegPath = require("@ffmpeg-installer/ffmpeg").path,
  ffprobePath = require("@ffprobe-installer/ffprobe").path,
  ffmpeg = require("fluent-ffmpeg");
const { USER_SERVICE } = require("../users");
ffmpeg.setFfprobePath(ffprobePath);
ffmpeg.setFfmpegPath(ffmpegPath);

module.exports = {
  name: "offlinevideos",
  mixins: [DbMongoose(Model), FunctionsCommon, FileMixin],

  /**
   * Settings
   */
  settings: {
    populates: {
      "videoFileId": "files.get",
    },
    populateOptions: ["videoFileId"]
  },

  /**
   * Dependencies
   */
  dependencies: [],

  /**
   * Actions
   */
  actions: {
    /**
     * Youtube video detail
     *
     * @returns
     */

    upload: {
      async handler(ctx) {
        const { filename } = ctx.meta;
        ctx.meta.$multipart.folder = "video";
        const file = await ctx.call("files.upload", ctx.params, { meta: ctx.meta });
        const thumbnail = await ctx.call("files.createThumbnailVideo", { id: file._id });
        const offlineVideoObject = {
          name: filename,
          videoFileId: file._id,
          thumbnailFileId: thumbnail?._id
        };
        const { userId, organizationId } = ctx.meta.$multipart;
        const offlineVideo = await this.adapter.insert(offlineVideoObject);
        await ctx.emit("offlineVideoUploaded", { offlineVideo, userId, organizationId });
        return offlineVideo;
      }
    },

    offlineVideoTranscript: {
      rest: {
        method: "GET",
        path: "/offline-video-transcript",
      },
      // visibility: "protected",
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const { offlineVideoId, cutStart, cutEnd } = ctx.params;
        return this.getOfflineVideoTranscript(offlineVideoId, cutStart, cutEnd);
      },
    },

    downloadVideo: {
      rest: {
        method: "GET",
        path: "/downloadVideo",
      },
      async handler(ctx) {
        const { offlineVideoId, cutStart, cutEnd } = ctx.params;

        const offlineVideo = await this.adapter.findById(offlineVideoId);
        const contentVideo = await this.broker.call('files.stream', { id: offlineVideo.videoFileId });

        const dirPath = this.getDirPath('video', storageDir);
        const localFilePath = this.getFilePath(offlineVideo.name, dirPath);

        if (!fs.existsSync(localFilePath)) {
          await this.saveToLocalStorage(contentVideo, localFilePath);
        }

        const extension = path.extname(offlineVideo.name);
        const fileName = path.basename(offlineVideo.name, extension);
        const cutingVideoPath = this.getFilePath(`${ fileName }_from_${ cutStart }_to_${ cutEnd }${ extension }`, dirPath);

        if (!fs.existsSync(cutingVideoPath)) {
          await this.cuttingAudio(localFilePath, cutingVideoPath, cutStart, cutEnd);
        }

        const responseFilename = `${ fileName.replace(/\s/g, "_") }${ extension }`;
        ctx.meta.$responseHeaders = {
          "Content-Disposition": `attachment;filename=${ responseFilename }`
        };
        return fs.createReadStream(cutingVideoPath, {});

      }
    },
    downloadAudio: {
      rest: {
        method: "GET",
        path: "/downloadAudio",
      },
      async handler(ctx) {
        const { offlineVideoId, cutStart, cutEnd } = ctx.params;

        const offlineVideo = await this.adapter.findById(offlineVideoId);
        const contentVideo = await this.broker.call('files.stream', { id: offlineVideo.videoFileId });

        const dirPath = this.getDirPath('video', storageDir);
        const fileName = path.basename(offlineVideo.name, path.extname(offlineVideo.name));
        const localFilePath = this.getFilePath(offlineVideo.name, dirPath);
        const mp3FilePath = this.getFilePath(`${ fileName }_from_${ cutStart }_to_${ cutEnd }.mp3`, dirPath);

        if (!fs.existsSync(localFilePath)) {
          await this.saveToLocalStorage(contentVideo, localFilePath);
        }

        if (!fs.existsSync(mp3FilePath)) {
          await this.cuttingVideoAudio(localFilePath, mp3FilePath, cutStart, cutEnd);
        }

        const responseFilename = `${ fileName.replace(/\s/g, "_") }_from_${ cutStart }_to_${ cutEnd }.mp3`;
        ctx.meta.$responseHeaders = {
          "Content-Disposition": `attachment;filename=${ responseFilename }`
        };

        return fs.createReadStream(mp3FilePath, {});
      }
    },
    list: {
      role: USER_CODES.SYSTEM_ADMIN
    },
    create: {
      role: USER_CODES.SYSTEM_ADMIN
    },
    update: {
      role: USER_CODES.SYSTEM_ADMIN
    },
    remove: {
      role: USER_CODES.SYSTEM_ADMIN
    },
  },

  /**
   * Events
   */
  events: {
    resourceOfflineVideoDeleted: {
      async handler(ctx) {
        const { id } = ctx.params;
        const offlineVideo = await this.adapter.removeById(id);
        try {
          await this.broker.call("files.remove", { id: offlineVideo.videoFileId });
        } catch (e) {
          console.log(e);
        }
        return offlineVideo;
      }
    }
  },

  /**
   * Methods
   */
  methods: {

    async getOfflineVideoTranscript(offlineVideoId, cutStart = 0, cutEnd = 0) {
      const offlineVideo = await this.adapter.findById(offlineVideoId);
      const cachedTranscript = this.offlineVideoTranscriptFromCache(
        offlineVideo,
        cutStart,
        cutEnd,
      );
      if (cachedTranscript) {
        return cachedTranscript;
      }
      const transcriptFromWhisper = await this.getTranscriptByWhispering(offlineVideoId, cutStart, cutEnd);
      if (transcriptFromWhisper && transcriptFromWhisper !== "") {
        this.cacheAudioTranscript(
          offlineVideo,
          cutStart,
          cutEnd,
          transcriptFromWhisper,
        );
        return transcriptFromWhisper;
      }
      return "";
    },


    offlineVideoTranscriptFromCache(offlineVideo, cutStart = 0, cutEnd = 0) {
      if (offlineVideo.transcripts && offlineVideo.transcripts.length > 0) {
        const transcript = offlineVideo.transcripts.find(
          (t) => t.cutStart === +cutStart && t.cutEnd === +cutEnd,
        );
        if (transcript) {
          return transcript.text;
        }
      }
    },

    async getTranscriptByWhispering(offlineVideoId, cutStart, cutEnd) {
      try {
        // Fetch offline video details
        const offlineVideo = await this.adapter.findById(offlineVideoId);

        // Get video content
        const contentVideo = await this.broker.call('files.stream', { id: offlineVideo.videoFileId });

        // Save video content to local storage if it doesn't exist
        const dirPath = this.getDirPath('video', storageDir);
        const localFilePath = this.getFilePath(offlineVideo.name, dirPath);
        if (!fs.existsSync(localFilePath)) {
          await this.saveToLocalStorage(contentVideo, localFilePath);
        }

        // Define file paths for mp3 and cut video
        const extension = path.extname(offlineVideo.name);
        const fileName = path.basename(offlineVideo.name, extension);


        const cuttingPromises = [];
        for (let i = cutStart; i <= cutEnd; i += 60) {
          const start = i;
          const end = i + 60 < cutEnd ? i + 60 : cutEnd;
          const mp3FilePath = this.getFilePath(`${ fileName }_from_${ start }_to_${ end }.mp3`, dirPath);
          cuttingPromises.push(this.cuttingVideoAudio(localFilePath, mp3FilePath, start, end));
        }
        // Cut video
        const results = await Promise.all(cuttingPromises);
        // Delete original video

        const promises = results.map(result => {
          return this.broker.call("whisper.transcriptAudio", {
            audioPath: result,
          });
        });

        const transcripts = await Promise.all(promises);
        // Delete mp3 files
        results.forEach(result => {
          fs.unlinkSync(result);
        });

        const text = transcripts.map(transcript => transcript.text).join(" ");
        console.log("text", text);
        return text;

      } catch (error) {
        console.log(error);
        return "";
      }
    },

    async cacheAudioTranscript(offlineVideo, cutStart = 0, cutEnd = 0, text) {
      offlineVideo.transcripts.push({
        cutStart,
        cutEnd,
        text: text,
      });
      await this.adapter.updateById(offlineVideo._id, offlineVideo);
    },

    extractAudioFromVideo(videoPath, audioPath) {

      return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .noVideo()
          .audioCodec('libmp3lame')
          .format('mp3')
          .on('end', () => {
            console.log('Audio extraction complete!');
            resolve(audioPath);
          })
          .on('error', (err) => console.error('Error extracting audio:', err))
          .save(audioPath);
      });
    }

  },

  /**
   * Service created lifecycle event handler
   */
  created() {
  },

  /**
   * Service started lifecycle event handler
   */
  async started() {
  },

  /**
   * Service stopped lifecycle event handler
   */
  async stopped() {
  },
};
