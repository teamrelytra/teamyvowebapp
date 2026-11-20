export const DIVISIONS = ['cch', 'fs', 'vfx', 'gfx', 'staff'];
export const ROLES = ['member', 'staff', 'admin', 'co-owner', 'owner'];
export const ROSTER_GROUPS = ['owner', 'co-owner', 'admin', ...DIVISIONS];
export const rank = role => ({ member: 1, staff: 2, admin: 3, 'co-owner': 4, owner: 5 })[role] || 0;
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireRole(user, minimum) {
  if (!user || user.deleted) throw new HttpError(401, 'Please log in again.');
  if (rank(user.role) < rank(minimum)) throw new HttpError(403, 'You do not have permission for this action.');
}
export function requireOwner(user) {
  requireRole(user, 'member');
  if (user.role !== 'owner') throw new HttpError(403, 'Only owners can do this.');
}
export function requireChannel(user, channel) {
  requireRole(user, 'member');
  if (!['general', 'tiktok', ...DIVISIONS].includes(channel)) throw new HttpError(404, 'Channel not found.');
  if (!['general', 'tiktok'].includes(channel) && rank(user.role) < rank('staff') && !user.divisions.includes(channel)) {
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
  requireRole(actor, 'staff');
  if (!target || target.deleted) throw new HttpError(404, 'Member not found.');
  if (actor.id === target.id || target.role === 'owner' || rank(target.role) >= rank(actor.role)) {
    throw new HttpError(403, 'You can only timeout members below your role.');
  }
}
export function requireProfileEdit(actor, target, nextRole) {
  requireRole(actor, 'admin');
  if (!target || target.deleted) throw new HttpError(404, 'Member not found.');
  if (nextRole !== target.role) {
    requireOwner(actor);
    if (!ROLES.includes(nextRole)) throw new HttpError(400, 'Choose a valid role.');
  }
}
export const publicProfile = p => ({
  id: p.id, username: p.username, role: p.role, divisions: p.divisions,
  displayName: p.displayName, title: p.title, bio: p.bio, avatarUrl: p.avatarUrl, createdAt: p.createdAt,
});
