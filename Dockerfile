FROM node:22

RUN apt-get update --fix-missing \
    && apt-get install -y poppler-data poppler-utils ffmpeg graphicsmagick libreoffice libsm6 libxi6 libxext6 imagemagick tesseract-ocr libtesseract-dev git ghostscript

ENV TZ=Asia/Ho_Chi_Minh
ARG DEBIAN_FRONTEND=noninteractive
RUN echo $TZ > /etc/timezone && \
    apt-get update && apt-get install -y tzdata && \
    rm /etc/localtime && \
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && \
    dpkg-reconfigure -f noninteractive tzdata && \
    apt-get clean

# install latest version of yt-dlp, should be fixed version
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
RUN chmod a+rx /usr/local/bin/yt-dlp

ENV NODE_ENV=production

RUN mkdir /app
WORKDIR /app

COPY ["package.json", "yarn.lock*", "./"]

RUN yarn install --production --frozen-lockfile

COPY . .

CMD ["yarn", "start"]