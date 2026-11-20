import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, requireOwner, requireRole, requireChannel, requireCanMessage, requireCanModerate, requireProfileEdit, publicProfile } from '../netlify/server/permissions.mjs';
const user = (role, overrides = {}) => ({ id: role, role, username: role, divisions: ['cch'], deleted: false, ...overrides });
const denied = fn => assert.throws(fn, error => [401, 403, 404].includes(error.status));

test('only owner rights grant token and account deletion permissions, including direct requests', () => {
  for (const role of ROLES) role === 'owner' ? requireOwner(user(role)) : denied(() => requireOwner(user(role)));
  denied(() => requireOwner(null)); denied(() => requireOwner(user('owner', { deleted: true })));
});
test('staff, admins, co-owners and owners can moderate; members cannot', () => {
  for (const role of ROLES) role === 'member' ? denied(() => requireRole(user(role), 'staff')) : requireRole(user(role), 'staff');
});
test('administrators may remove any division from a profile without changing its website role', () => {
  requireProfileEdit(user('admin'), user('member'), 'member');
  requireProfileEdit(user('admin'), user('owner'), 'owner');
  denied(() => requireProfileEdit(user('staff'), user('member'), 'member'));
  denied(() => requireProfileEdit(user('admin'), user('member'), 'owner'));
  denied(() => requireProfileEdit(user('co-owner'), user('member'), 'admin'));
  requireProfileEdit(user('owner'), user('member'), 'admin');
});
test('timeouts prevent sending in every channel but permit reading', () => {
  const target = user('member', { timeoutUntil: new Date(Date.now() + 60000).toISOString() });
  for (const channel of ['general', 'tiktok', 'cch']) {
    requireChannel(target, channel); denied(() => requireCanMessage(target, channel));
  }
  requireCanMessage(user('member', { timeoutUntil: new Date(Date.now() - 60000).toISOString() }), 'general');
  requireCanMessage(user('member', { timeoutUntil: null }), 'general');
});
test('division access is revoked when the division is removed from a card', () => {
  requireChannel(user('member', { divisions: ['vfx'] }), 'vfx');
  denied(() => requireChannel(user('member', { divisions: [] }), 'vfx'));
  requireChannel(user('staff'), 'vfx');
  denied(() => requireChannel(user('owner'), 'unknown'));
});
test('moderators cannot timeout themselves, peers, higher roles or owners', () => {
  requireCanModerate(user('staff'), user('member'));
  requireCanModerate(user('admin'), user('staff'));
  requireCanModerate(user('owner'), user('co-owner'));
  for (const role of ROLES) {
    denied(() => requireCanModerate(user(role), user('owner')));
    denied(() => requireCanModerate(user(role), user(role)));
  }
  denied(() => requireCanModerate(user('staff'), user('admin')));
});
test('public cards do not expose moderation or authentication fields', () => {
  const card = publicProfile(user('member', { provider: 'identity', timeoutUntil: 'private', deleted: false }));
  for (const field of ['provider', 'timeoutUntil', 'deleted']) assert.equal(field in card, false);
});
