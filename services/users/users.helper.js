const bcrypt = require('bcryptjs');

exports.encryptPassword = (palinText) => {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(palinText, salt);
}
exports.comparePassword = (plainText, encrypedPassword) => {
  return bcrypt.compareSync(plainText, encrypedPassword);
}



