export const DIVISIONS = ['cch', 'fs', 'vfx', 'gfx', 'staff'];

// SYSTEM roles control what an account may do. Co-Owner is intentionally NOT a system role.
export const ROLES = ['member', 'staff', 'admin', 'website-developer'];
export const DEVELOPER = 'website-developer';
export const rank = role => ({ member: 1, staff: 2, admin: 3, [DEVELOPER]: 4 })[role] || 0;

// ROSTER titles and divisions are organizational labels ONLY. Nothing below ever reads them to grant access.
export const ROSTER_TITLES = ['owner', 'co-owner', 'website-developer', 'admin', 'staff'];
export const ROSTER_DIVISIONS = ['leadership', 'administration', 'staff'];
export const ROSTER_GROUPS = [...ROSTER_DIVISIONS, 'cch', 'fs', 'vfx', 'gfx'];
export const TITLE_DIVISION = { owner: 'leadership', 'co-owner': 'leadership', 'website-developer': 'leadership', admin: 'administration', staff: 'staff' };

// Individually assignable feature permissions. Only a Website Developer can grant or change them.
export const PERMISSIONS = {
  'chat.moderate': 'Delete messages and time out members',
  'divisions.all': 'Read and post in every division channel and vault',
  'roster.manage': 'Manage member cards and roster entries',
  'announcements.manage': 'Post and remove announcements',
  'vault.manage': 'Add and remove team vault resources',
  'tiktok.manage': 'Pin and remove TikTok videos',
};
export const PERMISSION_KEYS = Object.keys(PERMISSIONS);
const MANAGE_KEYS = ['roster.manage', 'announcements.manage', 'vault.manage', 'tiktok.manage'];
// Existing system-role behaviour is preserved as defaults. Explicit permissions only ADD to these.
const ROLE_DEFAULTS = {
  member: [],
  staff: ['chat.moderate', 'divisions.all'],
  admin: ['chat.moderate', 'divisions.all', ...MANAGE_KEYS],
};

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const isDeveloper = user => !!user && !user.deleted && user.role === DEVELOPER;
export function can(user, permission) {
  if (!user || user.deleted) return false;
  if (user.role === DEVELOPER) return true;
  return (ROLE_DEFAULTS[user.role] || []).includes(permission) || (user.permissions || []).includes(permission);
}
export const effectivePermissions = user => (isDeveloper(user) ? PERMISSION_KEYS : PERMISSION_KEYS.filter(k => can(user, k)));
export const canManageAny = user => MANAGE_KEYS.some(k => can(user, k));
export function requireRole(user, minimum) {
  if (!user || user.deleted) throw new HttpError(401, 'Please log in again.');
  if (rank(user.role) < rank(minimum)) throw new HttpError(403, 'You do not have permission for this action.');
}
export function requirePermission(user, permission) {
  requireRole(user, 'member');
  if (!can(user, permission)) throw new HttpError(403, 'You do not have permission for this action.');
}
export function requireManager(user) {
  requireRole(user, 'member');
  if (!canManageAny(user)) throw new HttpError(403, 'You do not have permission for this action.');
}
export function requireDeveloper(user) {
  requireRole(user, 'member');
  if (user.role !== DEVELOPER) throw new HttpError(403, 'Only Website Developers can do this.');
}
export function requireChannel(user, channel) {
  requireRole(user, 'member');
  if (!['general', 'tiktok', ...DIVISIONS].includes(channel)) throw new HttpError(404, 'Channel not found.');
  if (!['general', 'tiktok'].includes(channel) && !can(user, 'divisions.all') && !user.divisions.includes(channel)) {
    throw new HttpError(403, 'This channel is for its division members.');
  }
}
export function requireCanMessage(user, channel) {
  requireChannel(user, channel);
  if (user.timeoutUntil && new Date(user.timeoutUntil).getTime() > Date.now()) {
    throw new HttpError(403, `You are timed out until ${new Date(user.timeoutUntil).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC.`);
  }
}
export function requireCanModerate(actor, target) {
  requirePermission(actor, 'chat.moderate');
  if (!target || target.deleted) throw new HttpError(404, 'Member not found.');
  // Someone holding only the permission moderates like staff: members, never peers or higher roles.
  const actorRank = Math.max(rank(actor.role), 2);
  if (actor.id === target.id || target.role === DEVELOPER || rank(target.role) >= actorRank) {
    throw new HttpError(403, 'You can only timeout members below your role.');
  }
}
export function requireProfileEdit(actor, target, nextRole) {
  requirePermission(actor, 'roster.manage');
  if (!target || target.deleted) throw new HttpError(404, 'Member not found.');
  if (nextRole !== target.role) {
    requireDeveloper(actor);
    if (!ROLES.includes(nextRole)) throw new HttpError(400, 'Choose a valid role.');
  }
}
export function cleanPermissions(value) {
  if (!Array.isArray(value)) throw new HttpError(400, 'Choose valid permissions.');
  const list = [...new Set(value)];
  if (list.some(k => !PERMISSION_KEYS.includes(k))) throw new HttpError(400, 'Choose valid permissions.');
  return PERMISSION_KEYS.filter(k => list.includes(k));
}
export function cleanRosterTitle(value) {
  const title = value ?? '';
  if (title !== '' && !ROSTER_TITLES.includes(title)) throw new HttpError(400, 'Choose a valid roster title.');
  return title;
}
// Public cards never include the system role, explicit permissions, Discord details or auth fields.
export const publicProfile = p => ({
  id: p.id, username: p.username, rosterTitle: p.rosterTitle || '', divisions: p.divisions,
  displayName: p.displayName, title: p.title, bio: p.bio, avatarUrl: p.avatarUrl, createdAt: p.createdAt,
});
// What a signed-in user may see about their own account.
export const selfProfile = p => ({
  id: p.id, username: p.username, role: p.role, rosterTitle: p.rosterTitle || '', divisions: p.divisions,
  displayName: p.displayName, title: p.title, bio: p.bio, avatarUrl: p.avatarUrl, createdAt: p.createdAt,
  timeoutUntil: p.timeoutUntil, permissions: p.permissions || [], can: effectivePermissions(p),
  discordUsername: p.discordId ? p.discordUsername : '', discordLinked: !!p.discordId,
});
// What managers see in the admin list. Explicit permissions and Discord links are for developers only.
export const managerProfile = (p, viewer) => ({
  ...publicProfile(p), role: p.role,
  ...(isDeveloper(viewer) ? { permissions: p.permissions || [], discordUsername: p.discordId ? p.discordUsername : '' } : {}),
});
