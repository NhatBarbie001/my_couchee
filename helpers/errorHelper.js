function createError(status_code, message) {
  const error = new Error(message);
  error.status_code = status_code;
  return error;
}

function createBadRequestError(message = 'Bad Request') {
  return createError(400, message);
}

function createNotFoundError(message = 'Not Found') {
  return createError(402, message);
}

export { createError, createBadRequestError, createNotFoundError };
