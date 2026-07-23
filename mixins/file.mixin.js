"use strict";

/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 * @typedef {import('moleculer-db').MoleculerDB} MoleculerDB  Moleculer's DB Service Schema
 */

const fs = require("fs");
const path = require("path");
const uploadDir = path.join(__dirname, "storage");
const sharp = require('sharp');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
const wav = require("wav");

module.exports = {
  methods: {
    saveToLocalStorage(stream, filePath) {
      return new this.Promise((resolve, reject) => {
        //reject(new Error("Disk out of space"));
        const f = fs.createWriteStream(filePath);
        f.on("close", async () => {
          // File written successfully
          this.logger.info(`Uploaded file stored in '${filePath}'`);
          resolve(filePath);
        });

        stream.on("error", (err) => {
          this.logger.info("File error received====================================1", err.message);
          reject(err);
          // Destroy the local file
          f.destroy(err);
        });

        f.on("error", (err) => {
          this.logger.info("File error received====================================2", err.message);
          // Remove the errored file.
          reject(err);
          fs.unlinkSync(filePath);
        });

        stream.pipe(f);
      });
    },
    createUniqueFileName(fileNameOrigin) {
      let fileName;
      if (fileNameOrigin) {
        let timeStamp = (new Date()).toISOString();
        timeStamp = timeStamp.replace(/:/g, '-');
        fileName = this.appendSuffix(fileNameOrigin, `_${timeStamp}`);
      }
      return fileName;
    },
    appendSuffix(fileNameOrigin, suffix) {
      let fileName;
      if (fileNameOrigin) {
        let fileExtension = this.getFileExtension(fileNameOrigin);
        let name = path.parse(fileNameOrigin).name;
        fileName = fileExtension === '' ? `${name.substring(0, 21)}${suffix}` : `${name.substring(0, 21)}${suffix}.${fileExtension}`;
      }
      return fileName;
    },
    appendFileName(fileNameOrigin, type = 'prefix', appendString) {
      if (!fileNameOrigin) return;

      const fileExtension = this.getFileExtension(fileNameOrigin);
      const name = path.parse(fileNameOrigin).name;

      const newName = type === 'prefix' ? `${appendString}${name}` : `${name}${appendString}`;
      return fileExtension === '' ? newName : `${newName}.${fileExtension}`;

    },
    getFileExtension(filename) {
      let ext = /^.+\.([^.]+)$/.exec(filename);
      return ext === null ? '' : ext[1];
    },
    getFilePath(fileName = '', filesDir = uploadDir) {
      if (!fileName) return null;
      return path.join(filesDir, fileName);
    },
    createFolderIfNotExist(folderPath) {
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, {recursive: true});
      }
    },
    getDirPath(dirName = "", rootPath = '') {
      const dirPath = path.resolve(rootPath, dirName);
      this.createFolderIfNotExist(dirPath);
      return dirPath;
    },

    async cuttingAudio(contentAudio, outputFilePath, cutStart, cutEnd) {
      return new Promise((resolve, reject) => {
        ffmpeg(contentAudio)
          .videoCodec('copy')
          .setStartTime(this.secondsToHMS(cutStart))
          .setDuration(cutEnd - cutStart)
          .output(outputFilePath)
          .on('end', () => {
            resolve(outputFilePath);
            console.log('=======================================Audio extraction complete', outputFilePath);
          })
          .on('error', (err) => {
            reject(err);
            console.error('=====================================Error extracting audio:', err);
          })
          .run();
      });
    },
    async cuttingVideoAudio(videoContentStream, outputFilePath, cutStart, cutEnd) {
      return new Promise((resolve, reject) => {
        ffmpeg(videoContentStream)
          .videoCodec('copy')
          .audioCodec('libmp3lame')
          .toFormat('mp3')
          .setStartTime(this.secondsToHMS(cutStart))
          .setDuration(cutEnd - cutStart)
          .on('error', (error) => {
            console.error('An error occurred: ' + error.message);
            reject(error);
          })
          .on('end', () => {
            console.log('Video Audio extraction complete', outputFilePath);
            resolve(outputFilePath);
          })
          .saveToFile(outputFilePath);
      });
    },
    async writeStream(filePath) {
      const writeStream = fs.createWriteStream(filePath);
      return new Promise((resolve) => {
        writeStream.on("finish", () => {
          resolve();
        });
      });
    },

    clearFolder(folderPath) {
      if (fs.existsSync(folderPath)) {
        fs.readdirSync(folderPath).forEach((file) => {
          const curPath = `${folderPath}/${file}`;
          if (fs.lstatSync(curPath).isDirectory()) {
            this.clearFolder(curPath);
          } else { // delete file
            fs.unlinkSync(curPath);
          }
        });
        fs.rmdirSync(folderPath);
      }
    },
    clearFilesInFolder(folderPath) {
      try {
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
          const curPath = path.join(folderPath, file);
          const stats = fs.lstatSync(curPath);
          if (!stats.isDirectory()) {
            fs.unlinkSync(curPath);
          } else {
            this.clearFilesInFolder(curPath);
          }
        }
      } catch (err) {
        console.error(`Lỗi khi xoá file trong thư mục: ${folderPath}`, err);
      }
    },
    saveFileToLocal(file, localPath) {
      return new Promise((resolve, reject) => {
        fs.writeFile(localPath, file, function (err) {
          if (err) {
            reject(err);
          }
          resolve(localPath);
        });
      });
    },

    saveAsWav(buffer, filePath) {
      const writer = new wav.FileWriter(filePath, {
        channels: 1,
        sampleRate: 16000,
        bitDepth: 16
      });

      writer.write(buffer);
      writer.end();
      console.log("File saved as WAV with PCM format.");
    },


  },
};
