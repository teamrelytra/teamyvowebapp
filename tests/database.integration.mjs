import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { createApp } from '../netlify/server/app.mjs';
import { createIdentityHandlers } from '../netlify/server/identity-handlers.mjs';
import * as schema from '../db/schema.ts';

// Every table, test account, generated credential and message is rolled back.
test('isolated Postgres: migrations, invitation claims, permissions, edits and chat moderation', async () => {
  const storage = new PGlite();
  const database = drizzle({ client: storage, schema });
  const rollback = new Error('expected-test-rollback');
  try {
    await database.transaction(async tx => {
      const namespace = 'yvo_test_' + randomUUID().replaceAll('-', '');
      await tx.execute(`CREATE SCHEMA ${namespace}`);
      await tx.execute(`SET LOCAL search_path TO ${namespace}`);
      const migration = await readFile(new URL('../netlify/database/migrations/20261119230553_create_team_hub/migration.sql', import.meta.url), 'utf8');
      for (const statement of migration.split('--> statement-breakpoint')) if (statement.trim()) await tx.execute(statement);
      const initialOwners = await tx.select().from(schema.profiles);
      assert.equal(initialOwners.length, 2);
      let currentId = initialOwners[0].id;
      const app = createApp({ database: tx, authenticateUser: async () => currentId ? (await tx.select().from(schema.profiles).where(eq(schema.profiles.id, currentId)))[0] : null });
      const call = async (action, fields = {}, origin = 'https://teamyvo.netlify.app') => app.request('https://teamyvo.netlify.app/api/action', {
        method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ action, ...fields }),
      });
      const fixture = async (role, divisions = ['cch', 'vfx']) => {
        const [row] = await tx.insert(schema.profiles).values({ id: randomUUID(), username: 'test_' + role.replace('-', '_'), role, divisions }).returning();
        return row;
      };
      const admin = await fixture('admin'), staff = await fixture('staff'), member = await fixture('member'), coowner = await fixture('co-owner');
      for (const person of [admin, staff, member, coowner]) {
        currentId = person.id;
        assert.equal((await call('createInvite', { username: 'fresh_player', role: 'member' })).status, 403);
        assert.equal((await call('deleteMember', { id: member.id })).status, 403);
      }
      currentId = initialOwners[0].id;
      assert.equal((await call('createInvite', {}, 'https://example.org')).status, 403);
      const inviteResponse = await call('createInvite', { username: 'fresh_player', role: 'member', divisions: ['cch', 'invalid'] });
      assert.equal(inviteResponse.status, 200);
      const { token } = await inviteResponse.json();
      const [invite] = await tx.select().from(schema.invites);
      assert.deepEqual(invite.divisions, ['cch']);
      assert.equal(invite.tokenHash.length, 64);
      assert.equal(Math.round((new Date(invite.expiresAt) - Date.now()) / 86400000), 7);
      const handlers = createIdentityHandlers(tx);
      const deny = () => { throw new Error('identity-denied'); };
      const identityUser = { id: randomUUID(), email: 'fresh_player@members.yvo.team', userMetadata: { activation_token: token }, appMetadata: {} };
      const validated = await handlers.userValidate({ user: identityUser, deny });
      assert.ok(validated.user.confirmedAt);
      const signup = await handlers.userSignup({ user: identityUser, deny });
      assert.equal(signup.user.userMetadata.activation_token, undefined);
      assert.ok(signup.user.confirmedAt);
      const [createdProfile] = await tx.select().from(schema.profiles).where(eq(schema.profiles.id, identityUser.id));
      assert.equal(createdProfile.role, 'member');
      await assert.rejects(() => handlers.userValidate({ user: identityUser, deny }), /identity-denied/);
      await assert.rejects(() => handlers.userValidate({ user: { ...identityUser, userMetadata: {} }, deny }), /identity-denied/);
      currentId = admin.id;
      assert.equal((await call('updateProfile', { id: member.id, displayName: 'Airborne', title: 'Player', divisions: ['cch'], role: 'owner' })).status, 403);
      assert.equal((await call('updateProfile', { id: member.id, displayName: 'Airborne', title: 'Player', divisions: ['cch'], role: 'member' })).status, 200);
      const [updated] = await tx.select().from(schema.profiles).where(eq(schema.profiles.id, member.id));
      assert.deepEqual(updated.divisions, ['cch']);
      currentId = member.id;
      assert.equal((await call('sendMessage', { channel: 'vfx', body: 'restricted' })).status, 403);
      assert.equal((await call('sendMessage', { channel: 'cch', body: 'First touch' })).status, 200);
      const [message] = await tx.select().from(schema.messages).where(eq(schema.messages.userId, member.id));
      assert.equal((await call('deleteMessage', { id: message.id })).status, 403);
      currentId = staff.id;
      assert.equal((await call('deleteMessage', { id: message.id })).status, 200);
      assert.equal((await call('timeoutMember', { id: member.id, minutes: 10 })).status, 200);
      assert.equal((await call('timeoutMember', { id: admin.id, minutes: 10 })).status, 403);
      currentId = member.id;
      for (const channel of ['general', 'tiktok', 'cch']) assert.equal((await call('sendMessage', { channel, body: 'blocked' })).status, 403);
      assert.equal((await call('messages', { channel: 'cch' })).status, 200);
      currentId = staff.id;
      assert.equal((await call('timeoutMember', { id: member.id, minutes: 0 })).status, 200);
      currentId = member.id;
      assert.equal((await call('sendMessage', { channel: 'general', body: 'Back in the game' })).status, 200);
      currentId = admin.id;
      assert.equal((await call('addRoster', { displayName: 'Aerial unit', division: 'co-owner' })).status, 200);
      const [entry] = await tx.select().from(schema.rosterMembers);
      assert.equal((await call('updateRoster', { id: entry.id, displayName: 'Air unit', title: 'Captain', division: 'owner' })).status, 200);
      currentId = initialOwners[0].id;
      assert.equal((await call('deleteMember', { id: member.id })).status, 200);
      currentId = member.id;
      assert.equal((await call('hubData')).status, 401);
      const [tombstone] = await tx.select().from(schema.profiles).where(eq(schema.profiles.id, member.id));
      assert.equal(tombstone.deleted, true);
      assert.equal((await tx.select().from(schema.messages).where(eq(schema.messages.userId, member.id))).length, 0);
      await assert.rejects(() => handlers.userLogin({ user: { id: member.id }, deny }), /identity-denied/);
      currentId = initialOwners[0].id;
      assert.equal((await call('updateProfile', { id: initialOwners[1].id, role: 'member', divisions: [] })).status, 200);
      assert.equal((await call('updateProfile', { id: initialOwners[0].id, role: 'member', divisions: [] })).status, 400);
      const publicResponse = await app.request('https://teamyvo.netlify.app/api/public');
      assert.equal(publicResponse.status, 200);
      const publicData = await publicResponse.json();
      assert.equal(publicData.members.some(p => p.id === member.id), false);
      assert.equal('timeoutUntil' in publicData.members[0], false);
      currentId = null;
      assert.equal((await call('hubData')).status, 401);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await storage.close(); }
});
