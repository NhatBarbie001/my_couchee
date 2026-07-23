// const DB_DEV_URI = 'mongodb://localhost:27017/tradar-evn-dev';
const DB_DEV_URI = "mongodb://root:thinklAb202x@118.70.156.51:4014/tradar-evn-dev?authSource=admin&authMechanism=SCRAM-SHA-256";
// const DB_DEV_URI = "mongodb://root:thinklAb202x@118.70.156.51:4014/tradar-evn-pro-16-03-2023?authSource=admin&authMechanism=SCRAM-SHA-256";

const config = {
  production: {
    secret: 'clickee@thinkLabs',
    secretRefresh: 'clickee@thinkLabsRefresh',
    MONGO_URI: process.env.MONGO_URI,
    port: process.env.PORT,
    domain: process.env.DOMAIN || 'https://app.clickee.ai',
    host_admin: process.env.DOMAIN || 'https://app.clickee.ai',
    client_id: process.env.CLIENT_ID || "413043088046-qai6ejq602e2ng5gimdku28s2e19gbch.apps.googleusercontent.com",
    client_secret: process.env.CLIENT_SECRET || "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",
    redirect_uri: process.env.REDIRECT_URI || "https://app.clickee.ai/auth/login-google",
    form_client_id: process.env.FORM_CLIENT_ID || "413043088046-n6ikic605fa6ml238c69mi9kaqc88bh6.apps.googleusercontent.com",
    form_client_secret: process.env.FORM_CLIENT_SECRET || "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",
    form_redirect_uri: process.env.FORM_REDIRECT_URI || "https://app.clickee.ai/google-form-callback",
    supportEmail: "hotro@clickee.vn",
    speechKey: '275zfZQvVfvLFwAeKkZ65p3snEGWBRS20mjBkUevYIHoK6bdNKKKJQQJ99AKACqBBLyXJ3w3AAAYACOGDMQz',
    serviceRegion: 'southeastasia',
    'mail': {
      'host': 'smtp.office365.com',
      'port': 587,
      'secure': false,
      'auth': {
        'user': 'hotro@clickee.vn',
        'pass': 'tjnkdwtpkzvgvndk',
      },
      tls: {
        rejectUnauthorized: false,
      }
    },
    mail_mailgun: {
      'auth': {
        'api_key': 'e1d4c20fa30e05a4cbc5c9435dc598f6-b892f62e-5d7832d3',
        'domain': 'sandboxd48b21c0aea74e508097ca22c1ac3ad7.mailgun.org',
      },
    },
    backend_base_url: 'http://localhost:3000',
    awsAccessKey: 'AKIAT34QLJYPD7MRFO3A',
    awsSecretKey: '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',
    awsRegion: 'ap-southeast-1',
  },
  development: {
    secret: 'evnnpt',
    secretRefresh: 'evnnptRefresh',
    MONGO_URI: process.env.MONGO_URI || DB_DEV_URI,
    port: 27017,
    'mail': {
      'host': 'smtp.office365.com',
      'port': 587,
      'secure': false,
      'auth': {
        'user': 'hotro@clickee.vn',
        'pass': 'tjnkdwtpkzvgvndk',
      },
      tls: {
        rejectUnauthorized: false,
      }
    },
    domain: process.env.DOMAIN || 'http://localhost:8080',
    host_admin: process.env.DOMAIN || 'http://localhost:8080',
    client_id: "413043088046-qai6ejq602e2ng5gimdku28s2e19gbch.apps.googleusercontent.com",
    client_secret: "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",
    redirect_uri: "http://localhost:8080/auth/login-google",
    form_client_id: "413043088046-n6ikic605fa6ml238c69mi9kaqc88bh6.apps.googleusercontent.com",
    form_client_secret: "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",
    form_redirect_uri: "http://localhost:8080/google-form-callback",
    supportEmail: "cskh@clickee.ai",
    microsoft_api_key: process.env.MICROSOFT_API_KEY || 'http://localhost:8080',
    mail_mailgun: {
      'auth': {
        'api_key': '22c6ee1fde1b7cbc0b360ef9a8c7d6da-4836d8f5-76b43d5c',
        'domain': 'thinklabs.vn',
      },
    },
    backend_base_url: '',
    speechKey: '275zfZQvVfvLFwAeKkZ65p3snEGWBRS20mjBkUevYIHoK6bdNKKKJQQJ99AKACqBBLyXJ3w3AAAYACOGDMQz',
    serviceRegion: 'southeastasia',
    awsAccessKey: 'AKIAT34QLJYPD7MRFO3A',
    awsSecretKey: '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',
    awsRegion: 'ap-southeast-1',
  },
};

exports.getConfig = env => config[env] || config.development;
