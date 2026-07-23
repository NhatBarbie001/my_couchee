'use strict';

const fs = require('fs');
const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const FileMixin = require('../../mixins/file.mixin');
const videosModel = require('./videos.model');
const DbMongoose = require('../../mixins/dbMongo.mixin');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const i18next = require('i18next');
ffmpeg.setFfmpegPath(ffmpegPath);
const storageDir = path.join(__dirname, 'storage');
const {MoleculerClientError} = require('moleculer').Errors;
const ytdl = require('@distube/ytdl-core');
const {USER_CODES} = require('../../constants/constant');
const {spawn} = require('child_process');
const os = require('os');

/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

/** @type {ServiceSchema} */
module.exports = {
  name: 'videos',
  mixins: [DbMongoose(videosModel), FunctionsCommon, FileMixin],

  /**
   * Settings
   */
  settings: {},

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
    list: {
      role: USER_CODES.SYSTEM_ADMIN,
    },
    create: {
      role: USER_CODES.SYSTEM_ADMIN,
    },
    get: {
      role: USER_CODES.SYSTEM_ADMIN,
    },
    update: {
      role: USER_CODES.SYSTEM_ADMIN,
    },
    videoDetail: {
      rest: {
        method: 'GET',
        path: '/video-detail',
      },
      auth: 'required',
      async handler(ctx) {
        const url = ctx.params.url;
        const validYouTubeUrl = this.validateYouTubeUrl(url);
        if (!validYouTubeUrl) {
          throw new MoleculerClientError(i18next.t('invalid_YouTube_URL'), 400, 'BAD_REQUEST');
        }
        return await this.getVideoDetail(url);
      },
    },
    videoTranscript: {
      rest: {
        method: 'GET',
        path: '/video-transcript',
      },
      auth: 'required',
      // role: USER_CODES.SYSTEM_ADMIN,
      // visibility: "protected",
      async handler(ctx) {
        const {url, cutStart, cutEnd} = ctx.params;
        return this.getVideoTranscript(url, cutStart, cutEnd);
      },
    },
    videoAudio: {
      rest: {
        method: 'GET',
        path: '/video-audio',
      },
      auth: 'required',
      role: USER_CODES.SYSTEM_ADMIN,
      // visibility: "protected",
      async handler(ctx) {
        const url = ctx.params.url;
        return this.getAudioFromYoutube(url);
      },
    },
    getOne: {
      rest: {
        method: 'GET',
        path: '/getOne',
      },
      role: USER_CODES.SYSTEM_ADMIN,
      auth: 'required',
      async handler(ctx) {
        const {videoId} = ctx.params;
        return this.adapter.findOne({videoId});
      },
    },
    remove: {
      rest: {
        method: 'DELETE',
        path: '/remove',
      },
      role: USER_CODES.SYSTEM_ADMIN,
      auth: 'required',
      async handler(ctx) {
        try {
          const {id} = ctx.params;
          return this.adapter.removeById(id);
        } catch (e) {
          console.log(e);
        }
      },
    },

    downloadAudio: {
      rest: {
        method: 'GET',
        path: '/downloadAudio',
      },
      async handler(ctx) {
        try {
          const {url, cutStart, cutEnd} = ctx.params;
          const videoId = await ytdl.getURLVideoID(url);
          const dirPath = this.getDirPath('videoAudio', storageDir);
          const audioFilePath = this.getFilePath(`${videoId}_from_${cutStart}_to_${cutEnd}.mp3`, dirPath);
          const localFilePath = this.getFilePath(`${videoId}.mp3`, dirPath);
          if (!fs.existsSync(localFilePath)) {
            const video = ytdl(url, {quality: 'lowestaudio'}, {filter: 'audioonly'});
            await this.saveToLocalStorage(video, localFilePath);
          }
          if (!fs.existsSync(audioFilePath)) {
            await this.cuttingVideoAudio(localFilePath, audioFilePath, cutStart, cutEnd);
          }
          const info = await ytdl.getInfo(url);
          ctx.meta.$responseHeaders = {
            'Content-Disposition': `attachment;filename=${encodeURI(info.videoDetails.title)}.mp3`,
          };
          return fs.createReadStream(audioFilePath, {});
        } catch (e) {
          console.log(e);
        }
      },
    },
  },

  /**
   * Events
   */
  events: {},

  /**
   * Methods
   */
  methods: {
    async getVideoById(videoId) {
      return await this.adapter.findOne({videoId});
    },
    async getVideoDetail(url) {
      try {
        const videoId = await ytdl.getURLVideoID(url);
        const cachedVideoDetail = await this.getVideoById(videoId);
        const {Innertube} = require('youtubei.js');
        const yt = await Innertube.create();
        if (cachedVideoDetail && cachedVideoDetail.thumbnailBase64) return cachedVideoDetail;

        const info = await yt.actions.execute('/player', {
          videoId,
          client: 'YTMUSIC', // InnerTube client to use.
          parse: true, // tells YouTube.js to parse the response (not sent to InnerTube).
        });
        info.videoDetails = info.video_details;
        const thumbnailBase64 = await this.imageUrlToBase64(
          info.videoDetails.thumbnail[info.videoDetails.thumbnail.length - 1].url,
        );
        const videoDetails = {
          ...info.videoDetails,
          embed: {
            iframeUrl: url,
            width: 1280,
            height: 720,
          },
          thumbnails: info.videoDetails.thumbnail,
          lengthSeconds: info.videoDetails.duration,
          videoId,
          url,
          thumbnailBase64,
        };

        if (cachedVideoDetail) {
          return await this.adapter.updateById(cachedVideoDetail._id, videoDetails);
        } else {
          return await this.adapter.insert(videoDetails);
        }
      } catch (error) {
        console.log('getVideoDetail========================================================', error);
      }
    },
    // async getTranscriptFromYoutube(videoId, cutStart, cutEnd) {
    //   try {
    //     const yt = await Innertube.create();
    //     const info = await yt.getInfo(videoId);

    //     const defaultTranscriptInfo = await info.getTranscript();

    //     return defaultTranscriptInfo?.transcript?.content?.body.initial_segments?.reduce((acc, curr) => {
    //       if (curr.end_ms <= cutEnd * 1000 && curr.start_ms >= cutStart * 1000) {
    //         acc += curr.snippet.text + " ";
    //       }
    //       return acc;
    //     }, "");
    //     // const videoId = await ytdl.getURLVideoID(url);
    //     // const captions = await YoutubeTranscript.fetchTranscript(videoId, {
    //     //   lang: "en",
    //     //   country: "US",
    //     // });
    //     // console.log("captions", captions);
    //     // return captions.reduce((acc, curr) => {
    //     //   const currentOffset = curr.offset / 1000;
    //     //   if (currentOffset >= cutStart && currentOffset <= cutEnd) {
    //     //     acc += curr.text + " ";
    //     //   }
    //     //   return acc;
    //     // }, "");
    //   } catch (error) {
    //     console.log(error);
    //     return "";
    //   }
    // },

  getYtDlpCommand() {
    return os.platform() === "win32" ? "yt-dlp.exe" : "yt-dlp";
  },

  runYtDlp(url, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const ytDlpCmd = this.getYtDlpCommand(); // ✅ this

      const args = [
        url,
        "--dump-single-json",
        "--write-auto-subs",
        "--skip-download",
        "--quiet",
        // "--cookies", "/app/cookies.txt",
        // "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        // "--no-check-certificates"
      ];

      const processRef = spawn(ytDlpCmd, args);

      let stdout = "";
      let stderr = "";

      const timeout = setTimeout(() => {
        processRef.kill("SIGKILL");
        reject(new Error("yt-dlp timeout"));
      }, timeoutMs);

      processRef.stdout.on("data", d => stdout += d.toString());
      processRef.stderr.on("data", d => stderr += d.toString());

      processRef.on("close", code => {
        clearTimeout(timeout);

        if (code !== 0) {
          return reject(new Error(stderr || "yt-dlp failed"));
        }

        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error("Invalid yt-dlp JSON output"));
        }
      });
    });
  },

  async getTranscriptFromYoutube(url, cutStart, cutEnd) {
    try {
      const data = await this.runYtDlp(url); // ✅ this

      const captionList =
        data.automatic_captions?.vi ||
        data.automatic_captions?.en;

      if (!captionList?.length) return "";

      const subObj =
        captionList.find(s => s.ext === "json3") || captionList[0];

      const response = await fetch(subObj.url);
      if (!response.ok) return "";

      const subData = await response.json();
      if (!Array.isArray(subData.events)) return "";

      let text = subData.events
        .filter(e => e.segs)
        .map(e => e.segs.map(s => s.utf8).join(""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      return text.slice(0, 30000);
    } catch (e) {
      this.logger.error(e);
      return "";
    }
  },
    async getAudioFromYoutube(url, cutStart, cutEnd) {
      const videoId = await ytdl.getURLVideoID(url);
      const dirPath = this.getDirPath('videoAudio', storageDir);
      const audioFilePath = this.getFilePath(`${videoId}_from_${cutStart}_to_${cutEnd}.mp3`, dirPath);
      const videoDetail = await this.getVideoDetail(url);
      if (
        videoDetail.audioFilePath &&
        videoDetail.audioFilePath === audioFilePath &&
        fs.existsSync(videoDetail.audioFilePath)
      ) {
        return {
          success: true,
          newFileCreated: false,
          filePath: videoDetail.audioFilePath,
          videoId,
          title: videoDetail.title,
        };
      }
      const video = ytdl(url, {quality: 'lowestaudio'}, {filter: 'audioonly'});
      await this.cuttingVideoAudio(video, audioFilePath, cutStart, cutEnd);
      videoDetail.audioFilePath = audioFilePath;
      await this.adapter.updateById(videoDetail._id, videoDetail);
      return {
        success: true,
        newFileCreated: true,
        filePath: audioFilePath,
        videoId,
        title: videoDetail.title,
      };
    },
    async getTranscriptByWhispering(url, videoId, cutStart, cutEnd) {
      try {
        const dirPath = this.getDirPath('videoAudio', storageDir);
        const localFilePath = this.getFilePath(`${videoId}.mp3`, dirPath);
        if (!fs.existsSync(localFilePath)) {
          const video = ytdl(url, {quality: 'lowestaudio'}, {filter: 'audioonly'});
          await this.saveToLocalStorage(video, localFilePath);
        }

        const cuttingPromises = [];
        for (let i = cutStart; i <= cutEnd; i += 60) {
          const start = i;
          const end = i + 60 < cutEnd ? i + 60 : cutEnd;
          const mp3FilePath = this.getFilePath(`${videoId}_from_${start}_to_${end}.mp3`, dirPath);
          cuttingPromises.push(this.cuttingVideoAudio(localFilePath, mp3FilePath, start, end));
        }
        // Cut video
        const results = await Promise.all(cuttingPromises);

        const promises = results.map(result => {
          return this.broker.call('whisper.transcriptAudio', {
            audioPath: result,
          });
        });

        const transcripts = await Promise.all(promises);
        // Delete mp3 files
        results.forEach(result => {
          fs.unlinkSync(result);
        });

        return transcripts.map(transcript => transcript.text).join(' ');
      } catch (error) {
        console.log(error);
        return '';
      }
    },

    getVideoTranscriptFromCache(videoDetail, cutStart = 0, cutEnd = 0) {
      if (videoDetail.transcripts && videoDetail.transcripts.length > 0) {
        const transcript = videoDetail.transcripts.find(t => t.cutStart === cutStart && t.cutEnd === cutEnd);
        if (transcript) {
          return transcript.text;
        }
      }
    },
    async cacheVideoTranscript(videoDetail, cutStart = 0, cutEnd = 0, text) {
      videoDetail.transcripts.push({
        cutStart,
        cutEnd,
        text: text,
      });
      await this.adapter.updateById(videoDetail._id, videoDetail);
    },
    async getVideoTranscript(url, cutStart = 0, cutEnd = 0) {
      const videoDetail = await this.getVideoDetail(url);
      const cachedTranscript = this.getVideoTranscriptFromCache(videoDetail, cutStart, cutEnd);
      if (cachedTranscript) {
        return cachedTranscript;
      }

      const transcriptFromYoutube = await this.getTranscriptFromYoutube(url, cutStart, cutEnd);
      if (transcriptFromYoutube && transcriptFromYoutube !== '') {
        await this.cacheVideoTranscript(videoDetail, cutStart, cutEnd, transcriptFromYoutube);
        return transcriptFromYoutube;
      }

      const transcriptFromWhisper = await this.getTranscriptByWhispering(url, videoDetail.videoId, cutStart, cutEnd);

      if (transcriptFromWhisper && transcriptFromWhisper !== '') {
        await this.cacheVideoTranscript(videoDetail, cutStart, cutEnd, transcriptFromWhisper);
        return transcriptFromWhisper;
      }
      return '';
    },
  },

  /**
   * Service created lifecycle event handler
   */
  created() {},

  /**
   * Service started lifecycle event handler
   */
  async started() {},

  /**
   * Service stopped lifecycle event handler
   */
  async stopped() {},
};
