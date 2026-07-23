const jwt = require("jsonwebtoken");
const { getConfig } = require("../config/config") ;

const config = getConfig(process.env.NODE_ENV);

module.exports = {
  issue(payload, expiresIn, secret) {
    return jwt.sign(payload, secret, {
      expiresIn
    });
  },
  async verifyToken(token, secret) {
    if (token) {
      try {
        return await jwt.verify(token, secret);
      } catch (error) {
        return null;
      }
    }
  },
};
