export function isAdminUser(user) {
  if (!user) return false;

  const directRole = String(user.role || user.user_role || '').toLowerCase();
  if (directRole === 'admin' || directRole === 'owner') return true;

  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (roles.some((role) => String(role).toLowerCase() === 'admin' || String(role).toLowerCase() === 'owner')) {
    return true;
  }

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  if (permissions.some((permission) => String(permission).toLowerCase().includes('admin'))) {
    return true;
  }

  return user.is_admin === true || user.admin === true;
}
