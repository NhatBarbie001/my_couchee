exports.validateUsername = username => {
  if (!username || username.trim().length === 0) {
    return {valid: false, error: 'error_username_required'};
  }

  const trimmed = username.trim();

  if (trimmed.length < 6 || trimmed.length > 32) {
    return {valid: false, error: 'error_username_length'};
  }

  // Only allow letters, numbers, dot, underscore
  if (!/^[a-zA-Z0-9._]+$/.test(trimmed)) {
    return {valid: false, error: 'error_username_invalid_format'};
  }

  return {valid: true};
};

exports.validatePassword = password => {
  if (!password || password.length < 8) {
    return {valid: false, error: 'error_password_length'};
  }

  // Must have: uppercase, lowercase, number, special character
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[@$!%*?&#]/.test(password);

  if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecialChar) {
    return {valid: false, error: 'error_password_weak'};
  }

  return {valid: true};
};

exports.validateFullName = fullName => {
  if (!fullName || fullName.trim().length === 0) {
    return {valid: false, error: 'error_fullname_required'};
  }

  const trimmed = fullName.trim();

  if (trimmed.length > 100) {
    return {valid: false, error: 'error_fullname_length'};
  }

  return {valid: true};
};

exports.validateEmail = email => {
  if (!email || email.trim().length === 0) {
    return {valid: false, error: 'error_email_required'};
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {valid: false, error: 'error_email_invalid_format'};
  }

  return {valid: true};
};

exports.validateRoleName = roleName => {
  if (!roleName || roleName.trim().length === 0) {
    return {valid: false, error: 'error_role_name_required'};
  }

  return {valid: true};
};

exports.validatePermissions = permissions => {
  if (!permissions || typeof permissions !== 'object') {
    return {valid: false, error: 'error_permissions_invalid'};
  }

  const validResources = ['organization', 'user', 'role', 'course', 'prompt', 'report', 'llmssettings', 'category'];
  const validActions = ['view', 'create', 'update', 'delete', 'restore'];

  for (const resource of Object.keys(permissions)) {
    if (!validResources.includes(resource)) {
      return {valid: false, error: 'error_permissions_invalid_resource'};
    }

    for (const action of Object.keys(permissions[resource])) {
      if (!validActions.includes(action)) {
        return {valid: false, error: 'error_permissions_invalid_action'};
      }

      if (typeof permissions[resource][action] !== 'boolean') {
        return {valid: false, error: 'error_permissions_invalid_value'};
      }
    }
  }

  return {valid: true};
};
