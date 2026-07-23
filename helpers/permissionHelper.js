const {RESOURCES, ACTIONS} = require('../constants/permissions');

async function hasPermission(ctx, resource, action) {
  const user = ctx.meta.user;

  if (user?.isSystemAdmin) {
    return true;
  }

  if (!user?.roleId || user.roleId.length === 0) {
    return false;
  }

  try {
    const roles = await ctx.call('roles.find', {
      query: {
        _id: {$in: user.roleId},
        isDeleted: false,
      },
    });

    const hasAccess = roles.some(role => {
      return role.permissions?.[resource]?.[action] === true;
    });

    return hasAccess;
  } catch (error) {
    console.error('Error checking permissions:', error);
    return false;
  }
}

async function hasAnyPermission(ctx, permissionsList) {
  for (const {resource, action} of permissionsList) {
    const allowed = await hasPermission(ctx, resource, action);
    if (allowed) {
      return true;
    }
  }
  return false;
}

async function hasAllPermissions(ctx, permissionsList) {
  for (const {resource, action} of permissionsList) {
    const allowed = await hasPermission(ctx, resource, action);
    if (!allowed) {
      return false;
    }
  }
  return true;
}

async function getUserPermissions(ctx) {
  const user = ctx.meta.user;

  if (user?.isSystemAdmin) {
    return {
      organization: {view: true, create: true, update: true, delete: true, restore: true},
      user: {view: true, create: true, update: true, delete: true, restore: true},
      role: {view: true, create: true, update: true, delete: true, restore: true},
      course: {view: true, create: true, update: true, delete: true, restore: true},
      prompt: {view: true, create: true, update: true, delete: true, restore: true},
      report: {view: true, create: true, update: true, delete: true, restore: true},
      category: {view: true, create: true, update: true, delete: true, restore: true},
      llmssettings: {view: true, create: true, update: true, delete: true, restore: true},
    };
  }

  if (!user?.roleId || user.roleId.length === 0) {
    return {};
  }

  try {
    const roles = await ctx.call('roles.find', {
      query: {
        _id: {$in: user.roleId},
        isDeleted: false,
      },
    });

    const mergedPermissions = {};

    roles.forEach(role => {
      if (role.permissions) {
        Object.keys(role.permissions).forEach(resource => {
          if (!mergedPermissions[resource]) {
            mergedPermissions[resource] = {view: false, create: false, update: false, delete: false, restore: false};
          }

          Object.keys(role.permissions[resource]).forEach(action => {
            if (role.permissions[resource][action]) {
              mergedPermissions[resource][action] = true;
            }
          });
        });
      }
    });

    return mergedPermissions;
  } catch (error) {
    console.error('Error getting user permissions:', error);
    return {};
  }
}

module.exports = {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getUserPermissions,
  RESOURCES,
  ACTIONS,
};
