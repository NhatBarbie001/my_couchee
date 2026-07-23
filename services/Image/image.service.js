const DbMongoose = require("../../mixins/dbMongo.mixin");
const IMAGE = require("./image.model");
const BaseService = require("../../mixins/baseService.mixin");
const {FILE_SERVICE} = require("../File");
const {USER_SERVICE} = require("../users");
const FileMixin = require("../../mixins/file.mixin");
const path = require("path");
const fs = require("fs");
const gm = require("gm");
const {SERVICE_NAME} = require("./index");
const studioDir = path.join(__dirname, "studio");
const Tesseract = require("node-tesseract-ocr");
const i18next = require("i18next");
const {MoleculerError} = require("moleculer").Errors;
const {MoleculerClientError} = require("moleculer").Errors;
const {ObjectId} = require("mongoose").Types;

const config = {
  lang: "eng",
  oem: 1,
  psm: 3,
};

module.exports = {
  name: SERVICE_NAME,
  mixins: [DbMongoose(IMAGE), BaseService, FileMixin],
  settings: {
    populates: {
      "imageFileId": FILE_SERVICE.get,
      "thumbnailFileId": FILE_SERVICE.get,
      "ownerId": USER_SERVICE.get
    },
    populateOptions: ["imageFileId", "thumbnailFileId", "ownerId"]
  },
  hooks: {
    before: {
      "imageToDescription|upload|imageToText": "checkAccess"
    }
  },
  actions: {
    upload: {
      auth: "required",
      async handler(ctx) {
        return this.uploadImage(ctx)
      }
    },
    uploadWithoutCheckAccess: {
      auth: "required",
      async handler(ctx) {
        return this.uploadImage(ctx)
      }
    },
    remove: {
      rest: "DELETE /:id",
      auth: "required",
      params: {
        id: "string",
      },
      /** @param {Context} ctx */
      async handler(ctx) {
        const {id} = ctx.params;
        const image = await this.adapter.findById(id);
        if (!image) {
          return new MoleculerClientError(i18next.t("error_file_not_found"), 404);
        }

        await Promise.all([
          ctx.call("files.remove", {id: image?.imageFileId}),
          ctx.call("files.remove", {id: image?.thumbnailFileId})
        ])

        return this.adapter.updateById(id, {isDeleted: true}, {new: true});
      }
    },
    imageToText: {
      auth: "required",
      async handler(ctx) {
        const {filename} = ctx.meta;
        const {top, left, width, height} = ctx.meta.$multipart;

        let uniqueFileName = this.createUniqueFileName(filename);
        const newFilePath = this.getFilePath(uniqueFileName, this.getStudioFolder());

        const imageOptimized = await this.optimizeImage(ctx.params, newFilePath);
        const metadata = await this.getImageMetadata(newFilePath);

        let imageCropped = imageOptimized;
        if (top && left && width && height) {
          uniqueFileName = this.appendFileName(uniqueFileName, 'prefix', 'cropped_');
          const croppedPath = this.getFilePath(uniqueFileName, this.getStudioFolder());
          imageCropped = await this.cropImage(imageOptimized, croppedPath, left, top, width, height);
        }

        const imageFile = await this.createImageFile(ctx, imageCropped, uniqueFileName);

        const thumbnailFile = await this.createThumbnail(ctx, imageCropped, uniqueFileName);
        const imageBuffer = fs.readFileSync(imageCropped);

        const text = await this.textFromImageByChatGPT(imageBuffer);
        const imageObject = {
          ownerId: ctx.meta.user?._id,
          name: filename,
          imageFileId: imageFile._id,
          thumbnailFileId: thumbnailFile._id,
          width: width || metadata.width,
          height: height || metadata.height,
          text
        };

        const image = await this.adapter.insert(imageObject);
        const {userId, organizationId} = ctx.meta.$multipart;
        await ctx.emit("imageExtracted", {image, userId, organizationId, text});
        return {image, text};
      }
    },
    imageToDescription: {
      auth: "required",
      async handler(ctx) {
        const {filename} = ctx.meta;
        const {top, left, width, height} = ctx.meta.$multipart;

        let uniqueFileName = this.createUniqueFileName(filename);
        const newFilePath = this.getFilePath(uniqueFileName, this.getStudioFolder());

        const imageOptimized = await this.optimizeImage(ctx.params, newFilePath);
        const metadata = await this.getImageMetadata(newFilePath);

        let imageCropped = imageOptimized;
        if (top && left && width && height) {
          uniqueFileName = this.appendFileName(uniqueFileName, 'prefix', 'cropped_');
          const croppedPath = this.getFilePath(uniqueFileName, this.getStudioFolder());
          imageCropped = await this.cropImage(imageOptimized, croppedPath, left, top, width, height);
        }

        const imageFile = await this.createImageFile(ctx, imageCropped, uniqueFileName);

        const thumbnailFile = await this.createThumbnail(ctx, imageCropped, uniqueFileName);
        const imageObject = {
          ownerId: ctx.meta.user?._id,
          name: filename,
          imageFileId: imageFile._id,
          thumbnailFileId: thumbnailFile._id,
          width: width || metadata.width,
          height: height || metadata.height
        };

        const image = await this.adapter.insert(imageObject);
        const text = await this.describe(fs.readFileSync(imageCropped));
        return {image, text};
      }
    },
    describeImage: {
      auth: "required",
      async handler(ctx) {
        const {imageId, responseId} = ctx.params;
        const imageDetail = await this.adapter.findOne({_id: imageId});
        if (!imageDetail) {
          throw new MoleculerError("Image not found", 404);
        }
        if (imageDetail.description) {
          return imageDetail.description;
        } else {
          const imageContent = await this.broker.call(FILE_SERVICE.data, {id: imageDetail.imageFileId});
          const text = await this.describe(imageContent, responseId);
          imageDetail.description = text;
          const imageUpdated = await this.adapter.updateById(imageDetail._id, imageDetail, {new: true});
          return text;
        }
      }
    },
    clearImage: {
      async handler() {
        this.clearFilesInFolder(this.getStudioFolder());
      }
    },
    getBase64: {
      async handler(ctx) {
        const {imageId} = ctx.params;
        const imageDetail = await this.adapter.findOne({_id: imageId});
        if (!imageDetail) {
          throw new MoleculerError("Image not found", 404);
        }
        const imageContent = await this.broker.call(FILE_SERVICE.data, {id: imageDetail.imageFileId});
        return this.base64FromBuffer(imageContent);
      }
    },
    textFromImageId: {
      async handler(ctx) {
        const {imageId} = ctx.params;
        const imageDetail = await this.adapter.findOne({_id: imageId});
        if (!imageDetail) {
          throw new MoleculerError("Image not found", 404);
        }
        const imageContent = await this.broker.call(FILE_SERVICE.data, {id: imageDetail.imageFileId});
        const base64 = await this.base64FromBuffer(imageContent);
        return this.textFromImageByChatGPT(base64);
      }
    }
  },
  methods: {
    async checkAccess(ctx) {
      const {workspaceId, fileSize} = ctx.meta.$multipart;
      let permission;
      let organizationId;
      let userId;
      if (workspaceId) {
        const workspace = await ctx.call("workspaces.get", {id: workspaceId});
        ({organizationId, userId} = workspace);
      } else {
        userId = ctx.meta.user?._id;
      }
      ctx.meta.$multipart = {...ctx.meta.$multipart, organizationId, userId};
      permission = await ctx.call("permissions.getOne", {organizationId, userId});

      if (permission && +permission.accessLimit.capacityUsed + fileSize / (1024 * 1024) > +permission.accessLimit.capacityLimit) {
        throw new MoleculerClientError(i18next.t("capacity_exceeded"), 405, "FORBIDDEN");
      }

      if (permission && permission.accessLimit.capacityUsed >= +permission.accessLimit.capacityLimit) {
        throw new MoleculerClientError(i18next.t("upgrade_your_plan"), 406);
      }
    },
    async createThumbnail(ctx, imageOptimized, uniqueFileName, used) {
      const thumbnailFileName = this.appendFileName(uniqueFileName, 'suffix', '_thumbnail');
      const thumbnailPath = this.getFilePath(thumbnailFileName, this.getStudioFolder());
      const imageThumbnail = await this.thumbnail(ctx, imageOptimized, thumbnailPath);
      return await ctx.call(FILE_SERVICE.save, fs.createReadStream(imageThumbnail), {
        meta: {
          ...ctx.meta,
          filename: thumbnailFileName,
          folder: 'images',
          fileType: 'image',
          used: used,
        }
      });
    },

    async createImageFile(ctx, imagePath, uniqueFileName, used) {
      return await ctx.call(FILE_SERVICE.save, fs.createReadStream(imagePath), {
        meta: {
          ...ctx.meta,
          filename: uniqueFileName,
          folder: 'images',
          fileType: 'image',
          used: used
        }
      });
    },

    getStudioFolder() {
      return studioDir;
    },
    optimizeImage(stream, outputFilePath) {
      try {
        return new Promise(((resolve, reject) => {
          gm(stream)
            // .autoOrient() theo issues #2919
            .resize(1024)
            .quality(80)
            .write(outputFilePath, function (err) {
              if (err) {
                reject(err);
              } else {
                resolve(outputFilePath);
              }
            });
        }));
      } catch (e) {
        console.log(e);
      }
    },
    thumbnail(ctx, filePath, outputFilePath) {
      const {isTemplate} = ctx.meta;
      let width = 256, height = 256, align = 'center';
      if (isTemplate) {
        width = 156;
        height = 190;
        align = 'top';
      }
      return new Promise(((resolve, reject) => {
        gm(filePath)
          // .autoOrient() theo issues #2919
          .thumb(width, height, outputFilePath, 80, align, null, (err) => {
            console.log(err);
            if (err) {
              reject(err);
            } else {
              resolve(outputFilePath);
            }
          });
      }));
    },
    async getExif(filePath) {
      const convertDMSToDD = (coordinates, direction) => {
        if (isNaN(coordinates?.degrees) || isNaN(coordinates?.minutes) || isNaN(coordinates?.seconds)) return null;
        const {degrees, minutes, seconds} = coordinates;

        let dd = degrees + minutes / 60 + seconds / (60 * 60);
        if (direction === 'S' || direction === 'W') dd *= -1;
        return dd;
      };

      const convertStringToDMS = (gpsString) => {
        if (!gpsString) return null;

        const division = (divisionInput) => {
          const divisionArr = divisionInput.toString().split('/');
          return parseInt(divisionArr[0]) / parseInt(divisionArr[1]);
        };

        const gpsArr = gpsString.toString().split(',');
        const degrees = division(gpsArr[0]);
        const minutes = division(gpsArr[1]);
        const seconds = division(gpsArr[2]);
        return {degrees, minutes, seconds};
      };

      const exifData = await this.exifReader(filePath);
      if (!exifData) return null;
      const latGps = exifData['GPS Latitude'];
      const lngGps = exifData['GPS Longitude'];
      const latRef = exifData['GPS Latitude Ref'];
      const lngRef = exifData['GPS Longitude Ref'];
      if (!latGps || !latRef || !lngGps || !lngRef) return {};
      return {
        lat: convertDMSToDD(convertStringToDMS(latGps), latRef),
        lng: convertDMSToDD(convertStringToDMS(lngGps), lngRef),
      };
    },
    async exifReader(filePath) {
      try {
        return new Promise((resolve, reject) => {
          gm(filePath)
            .identify(function (err, data) {
              if (err) return reject(null);
              const exifData = data['Profile-EXIF'];
              resolve(exifData);
            });
        });
      } catch (e) {
        return null;
        // console.log('err', e);
      }
    },
    async getImageMetadata(filePath) {
      return new Promise((resolve, reject) => {
        // obtain the size of an image
        gm(filePath)
          .size(function (err, size) {
            if (!err) {
              resolve(size);
            } else {
              reject(err);
            }
          });
      });
    },

    async textFromImageByChatGPT(imageBuffer) {
      const messages = [
        {
          role: "user",
          content: "Get the text in the image"
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
                detail: "high"
              },
            }
          ]
        },
        {
          role: "user",
          content: "Return only text in the image. If you don't have a text in the image, just return an empty string."
        }
      ]

      return await this.broker.call(`chatgpt.chatCompletion`, {
        messages,
        responseFormat: "markdown",
        temperature: "0.3",
      });
    },
    async describe(imageBuffer, responseId, instruction) {
      // fs.unlinkSync(filePath);
      return await this.broker.call("gpt4v.describeImage", {
        imageBuffer: imageBuffer,
        instruction: instruction,
        responseId
      });
    },
    cropImage(inputPath, outputPath, leftPercent, topPercent, widthPercent, heightPercent) {
      try {
        return new Promise(((resolve, reject) => {
          gm(inputPath)
            .size((err, size) => {
              if (err) {
                return reject(err);
              }
              const left = Math.floor(size.width * leftPercent / 100);
              const top = Math.floor(size.height * topPercent / 100);
              const width = Math.floor(size.width * widthPercent / 100);
              const height = Math.floor(size.height * heightPercent / 100);

              gm(inputPath)
                .crop(width, height, left, top)
                .write(outputPath, (err) => {
                  if (err) {
                    reject(err);
                  } else {
                    resolve(outputPath);
                  }
                });
            });
        }));
      } catch (err) {
        console.log(err);
      }
    },
    base64FromBuffer: (imageBuffer) => {
      try {
        return imageBuffer.toString("base64");
      } catch (error) {
        return error;
      }
    },
    async uploadImage(ctx) {
      const {filename, userID} = ctx.meta;
      const {used} = ctx.meta.$multipart;

      const studioFolder = this.getStudioFolder();
      let uniqueFileName = this.createUniqueFileName(filename);
      const newFilePath = this.getFilePath(uniqueFileName, studioFolder);

      let imageOptimized = await this.optimizeImage(ctx.params, newFilePath);

      const extension = path.extname(imageOptimized);
      const name = path.basename(imageOptimized, extension);


      if (extension.includes("tiff")) {
        const convertPath = this.getFilePath(`${name}.png`, this.getStudioFolder());
        await this.convertTiffToPng(imageOptimized, convertPath)
        uniqueFileName = `${name}.png`
        imageOptimized = convertPath
      }
      await this.timeout(200);

      const [imageFile, thumbnailFile, exif, metadata] = await Promise.all([
        this.createImageFile(ctx, imageOptimized, uniqueFileName, used),
        this.createThumbnail(ctx, imageOptimized, uniqueFileName, used),
        this.getExif(newFilePath),
        this.getImageMetadata(newFilePath)
      ]);

      const {height, width} = metadata;

      const imageObject = {
        ownerId: userID,
        name: filename,
        imageFileId: imageFile._id,
        thumbnailFileId: thumbnailFile._id,
        ...exif,
        height,
        width
      };

      return this.adapter.insert(imageObject);
    },
    async timeout(delay) {
      return new Promise((res) => setTimeout(res, delay));
    },
  },
  events: {
    resourceImageDeleted: {
      async handler(ctx) {
        const {id} = ctx.params;
        const image = await this.adapter.removeById(id);
        try {
          ctx.call("files.remove", {id: image.imageFileId});
          ctx.call("files.remove", {id: image.thumbnailFileId});
        } catch (e) {
          console.log(e);
        }
        return image;
      }
    },
    imageUpdateSubmit: {
      async handler(ctx) {
        const { inputData } = ctx.params;
        const fileIds = new Set();

        if (inputData?.imageIds) {
          const images = await this.adapter.find({ query: { _id: { $in: inputData.imageIds } } });
          images.forEach(image => {
            fileIds.add(image.imageFileId);
            fileIds.add(image.thumbnailFileId);
          });
        }

        if (inputData?.topicImageId || inputData?.imageId) {
          const image = await this.broker.call("images.get", { id: inputData.imageId || inputData.topicImageId });
          fileIds.add(image.imageFileId);
          fileIds.add(image.thumbnailFileId);
        }

        if (inputData?.fileId) {
          fileIds.add(inputData.fileId);
        }

        if (fileIds.size > 0) {
          await ctx.call("files.updateMany", {
            query: { _id: { $in: Array.from(fileIds).map(item => ObjectId(item)) } },
            update: { used: true }
          });
        }
      }
    }
  },

  /**
   * Service started lifecycle event handler
   */
  async started() {
    this.createFolderIfNotExist(studioDir);
  },
};
