import { getMessageError } from '../constant/messageError';
import { getMessage } from '../constant/messageSuccess';
import CommonError from '../error/CommonError';
import { loggerResponse, loggerError } from '../logs/middleware';

export function success(res, docs, code = 200, message = undefined) {

  // save log system.
  let messageSuccess = getMessage(message, res.lang_id || 'vi');
  try {
    res.status(code).json({
      success: true,
      data: docs,
      message: messageSuccess,
    });
    if (res.req.method !== 'GET') {
      loggerResponse(res.req);
    }
  } catch (e) {
    console.log(e);
  }
}

export function error(res, err = CommonError.UNEXPECTED_ERROR, code, message) {
  console.log(err);
  err = typeof err === 'function' ? err() : err;
  code = code || (err && err.status_code || 400);
  message = message || err.message;
  let messageErr = getMessageError(message, err, res.lang_id || 'vi');
  let response = {
    success: false,
    message: messageErr,
    data: err,
  };
  try {
    res.status(code).json(response);
    if (res.req.method !== 'GET') {
      loggerError(res.req, messageErr);
    }
  } catch (e) {
    console.log(e);
  }
}
