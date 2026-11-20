import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { and, eq, desc, asc, gt, isNull, sql } from 'drizzle-orm';
import * as t from '../../db/schema.ts';
import {
  DIVISIONS, ROLES, ROSTER_GROUPS, rank, HttpError, requireRole, requireOwner,
  requireChannel, requireCanMessage, requireCanModerate, requireProfileEdit, publicProfile,
} from './permissions.mjs';

export function createApp({ database, authenticateUser = null }) {
const db = database;
// Keep the two existing accounts working. All authorization and application data now live here.
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(new URL('../../public/config.js', import.meta.url), 'utf8'), sandbox);
const legacy = sandbox.window.YVO;
const app = new Hono();
const allowedOrigins = new Set(['https://teamyvo.netlify.app', ...['URL', 'DEPLOY_URL', 'DEPLOY_PRIME_URL'].map(key => process.env[key]).filter(Boolean)].map(value => new URL(value).origin));
if (process.env.NETLIFY_DEV === 'true') { allowedOrigins.add('http://localhost:8889'); allowedOrigins.add('http://127.0.0.1:8889'); }
const hash = value => createHash('sha256').update(value.trim().toUpperCase()).digest('hex');
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const listDivisions = value => [...new Set(Array.isArray(value) ? value : [])].filter(d => DIVISIONS.includes(d));
const validUrl = (value, optional = false) => {
  if (!value && optional) return '';
  try { const u = new URL(value); if (!['https:', 'http:'].includes(u.protocol)) throw 0; return u.href; }
  catch { throw new HttpError(400, 'Enter a valid http or https URL.'); }
};
const profileById = async id => (await db.select().from(t.profiles).where(eq(t.profiles.id, text(id))).limit(1))[0];
const audit = (tx, actor, action, targetId = null) => tx.insert(t.auditLog).values({
  id: randomUUID(), actorId: actor.id, action, targetId,
});

app.use('/api/*', bodyLimit({ maxSize: 16000, onError: c => c.json({ error: 'Request is too large.' }, 413) }));
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (!origin || !allowedOrigins.has(origin)) return c.json({ error: 'Request origin is not allowed.' }, 403);
    if (!c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: 'Send JSON.' }, 415);
  }
  await next();
});

async function authenticate(c) {
  if (authenticateUser) return authenticateUser(c);
  const provider = c.req.header('x-yvo-auth') === 'legacy' ? 'legacy' : 'identity';
  let jwt = c.req.header('authorization')?.replace(/^Bearer /, '');
  if (!jwt && provider === 'identity') {
    const cookie = c.req.header('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('nf_jwt='));
    if (cookie) try { jwt = decodeURIComponent(cookie.slice(7)); } catch { /* invalid cookie */ }
  }
  if (!jwt) return null;
  const url = provider === 'legacy' ? legacy.SUPABASE_URL + '/auth/v1/user'
    : new URL('/.netlify/identity/user', process.env.URL || 'https://teamyvo.netlify.app').href;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}`, ...(provider === 'legacy' ? { apikey: legacy.SUPABASE_ANON_KEY } : {}) },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const user = await response.json();
  const profile = await profileById(user.id);
  return profile && !profile.deleted && profile.provider === provider ? profile : null;
}

app.get('/api/public', async c => {
  const [roster, members, posts] = await Promise.all([
    db.select().from(t.rosterMembers).orderBy(asc(t.rosterMembers.sort), asc(t.rosterMembers.displayName)),
    db.select().from(t.profiles).where(eq(t.profiles.deleted, false)),
    db.select().from(t.tiktokPosts).orderBy(desc(t.tiktokPosts.postedAt)).limit(12),
  ]);
  return c.json({ roster, members: members.map(publicProfile), posts });
});

app.get('/api/me', async c => c.json({ me: await authenticate(c) }));

// Failed activations are limited persistently, across cold starts and instances.
app.post('/api/prepare-claim', async c => {
  const { token } = await c.req.json();
  if (typeof token !== 'string' || token.length > 100) throw new HttpError(400, 'Enter your activation token.');
  const ip = c.req.header('x-nf-client-connection-ip') || c.req.header('x-forwarded-for')?.split(',')[0] || 'unknown';
  const key = hash('claim:' + ip);
  const [attempt] = await db.insert(t.claimAttempts).values({ key }).onConflictDoUpdate({
    target: t.claimAttempts.key,
    set: {
      attempts: sql`CASE WHEN ${t.claimAttempts.windowStart} < now() - interval '10 minutes' THEN 1 ELSE ${t.claimAttempts.attempts} + 1 END`,
      windowStart: sql`CASE WHEN ${t.claimAttempts.windowStart} < now() - interval '10 minutes' THEN now() ELSE ${t.claimAttempts.windowStart} END`,
    },
  }).returning();
  if (attempt.attempts > 8) throw new HttpError(429, 'Too many attempts. Try again in 10 minutes.');
  const [invite] = await db.select().from(t.invites).where(and(
    eq(t.invites.tokenHash, hash(token)), isNull(t.invites.claimedAt), gt(t.invites.expiresAt, new Date().toISOString()),
  )).limit(1);
  if (!invite) throw new HttpError(400, 'Invalid or expired activation token.');
  return c.json({ username: invite.username });
});

app.use('/api/action', async (c, next) => { c.set('me', await authenticate(c)); requireRole(c.get('me'), 'member'); await next(); });
app.post('/api/action', async c => {
  const p = await c.req.json(), me = c.get('me');
  switch (p.action) {
    case 'hubData': {
      const [resources, announcements, moderationMembers] = await Promise.all([
        db.select().from(t.resources).orderBy(t.resources.title),
        db.select().from(t.announcements).orderBy(desc(t.announcements.createdAt)).limit(5),
        rank(me.role) >= 2 ? db.select({ id: t.profiles.id, username: t.profiles.username, role: t.profiles.role, timeoutUntil: t.profiles.timeoutUntil }).from(t.profiles).where(eq(t.profiles.deleted, false)).orderBy(t.profiles.username) : [],
      ]);
      return c.json({ resources: resources.filter(r => rank(me.role) >= rank(r.minRole) && (!r.division || rank(me.role) >= 2 || me.divisions.includes(r.division))), announcements, moderationMembers, me });
    }
    case 'messages': {
      requireChannel(me, p.channel);
      const messages = await db.select().from(t.messages).where(eq(t.messages.channel, p.channel)).orderBy(desc(t.messages.createdAt)).limit(75);
      return c.json({ messages: messages.reverse(), timeoutUntil: me.timeoutUntil });
    }
    case 'sendMessage': {
      requireCanMessage(me, p.channel);
      const body = text(p.body, 2000);
      if (!body) throw new HttpError(400, 'Write a message first.');
      // Lock the profile so a simultaneous timeout cannot race a message insertion.
      await db.transaction(async tx => {
        const [current] = await tx.select().from(t.profiles).where(eq(t.profiles.id, me.id)).for('update');
        requireCanMessage(current, p.channel);
        await tx.insert(t.messages).values({ id: randomUUID(), userId: me.id, username: me.username, channel: p.channel, body });
      });
      return c.json({ ok: true });
    }
    case 'deleteMessage': {
      requireRole(me, 'staff');
      const [message] = await db.select().from(t.messages).where(eq(t.messages.id, text(p.id)));
      if (!message) throw new HttpError(404, 'Message not found.');
      requireChannel(me, message.channel);
      await db.transaction(async tx => { await tx.delete(t.messages).where(eq(t.messages.id, message.id)); await audit(tx, me, 'deleteMessage', message.id); });
      return c.json({ ok: true });
    }
    case 'timeoutMember': {
      const target = await profileById(p.id); requireCanModerate(me, target);
      const minutes = Number(p.minutes);
      if (![0, 5, 10, 30, 60, 1440, 10080].includes(minutes)) throw new HttpError(400, 'Choose a timeout duration.');
      const timeoutUntil = minutes ? new Date(Date.now() + minutes * 60000).toISOString() : null;
      await db.transaction(async tx => {
        await tx.update(t.profiles).set({ timeoutUntil }).where(eq(t.profiles.id, target.id));
        await audit(tx, me, minutes ? 'timeoutMember' : 'clearTimeout', target.id);
      });
      return c.json({ ok: true, timeoutUntil });
    }
    case 'adminData': {
      requireRole(me, 'admin');
      const [members, roster, resources, announcements, posts, invites] = await Promise.all([
        db.select().from(t.profiles).where(eq(t.profiles.deleted, false)).orderBy(t.profiles.username),
        db.select().from(t.rosterMembers).orderBy(t.rosterMembers.sort, t.rosterMembers.displayName),
        db.select().from(t.resources), db.select().from(t.announcements).orderBy(desc(t.announcements.createdAt)),
        db.select().from(t.tiktokPosts).orderBy(desc(t.tiktokPosts.postedAt)),
        me.role === 'owner' ? db.select({ id: t.invites.id, username: t.invites.username, role: t.invites.role, divisions: t.invites.divisions, expiresAt: t.invites.expiresAt }).from(t.invites).where(and(isNull(t.invites.claimedAt), gt(t.invites.expiresAt, new Date().toISOString()))) : [],
      ]);
      return c.json({ members, roster, resources, announcements, posts, invites });
    }
    case 'createInvite': {
      requireOwner(me);
      const username = text(p.username).toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new HttpError(400, 'Username must be 3–20 letters, numbers or underscores.');
      if (!ROLES.includes(p.role)) throw new HttpError(400, 'Choose a valid role.');
      const [existing] = await db.select({ id: t.profiles.id }).from(t.profiles).where(eq(t.profiles.username, username));
      if (existing) throw new HttpError(409, 'That username is already taken.');
      const token = 'YVO-' + randomBytes(16).toString('hex').toUpperCase();
      await db.insert(t.invites).values({ id: randomUUID(), tokenHash: hash(token), username, role: p.role, divisions: listDivisions(p.divisions), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() });
      return c.json({ username, token });
    }
    case 'deleteInvite': {
      requireOwner(me); await db.delete(t.invites).where(eq(t.invites.id, text(p.id))); return c.json({ ok: true });
    }
    case 'updateProfile': {
      const target = await profileById(p.id), nextRole = p.role ?? target?.role;
      requireProfileEdit(me, target, nextRole);
      await db.transaction(async tx => {
        // Serialize owner-role changes so two requests cannot remove every owner.
        const owners = await tx.select().from(t.profiles).where(and(eq(t.profiles.role, 'owner'), eq(t.profiles.deleted, false))).for('update');
        if (target.role === 'owner' && nextRole !== 'owner' && owners.length <= 1) throw new HttpError(400, 'Keep at least one owner.');
        await tx.update(t.profiles).set({ displayName: text(p.displayName, 50) || target.username, title: text(p.title, 80), bio: text(p.bio, 500), avatarUrl: validUrl(p.avatarUrl, true), divisions: listDivisions(p.divisions), role: nextRole }).where(eq(t.profiles.id, target.id));
        await audit(tx, me, 'updateProfile', target.id);
      });
      return c.json({ ok: true });
    }
    case 'deleteMember': {
      requireOwner(me); const target = await profileById(p.id);
      if (!target || target.deleted) throw new HttpError(404, 'Member not found.');
      if (target.id === me.id) throw new HttpError(400, 'You cannot delete your own account.');
      await db.transaction(async tx => {
        const owners = await tx.select().from(t.profiles).where(and(eq(t.profiles.role, 'owner'), eq(t.profiles.deleted, false))).for('update');
        if (target.role === 'owner' && owners.length <= 1) throw new HttpError(400, 'Keep at least one owner.');
        await tx.delete(t.messages).where(eq(t.messages.userId, target.id));
        // A tombstone rejects existing sessions and prevents legacy accounts from reappearing.
        await tx.update(t.profiles).set({ deleted: true, displayName: '', title: '', bio: '', avatarUrl: '', divisions: [], role: 'member', timeoutUntil: null }).where(eq(t.profiles.id, target.id));
        await tx.delete(t.invites).where(eq(t.invites.username, target.username));
        await audit(tx, me, 'deleteMember', target.id);
      });
      return c.json({ ok: true });
    }
    case 'addRoster': case 'updateRoster': {
      requireRole(me, 'admin');
      if (!ROSTER_GROUPS.includes(p.division) || !text(p.displayName)) throw new HttpError(400, 'Add a name and choose a roster group.');
      const fields = { displayName: text(p.displayName, 50), title: text(p.title, 80), avatarUrl: validUrl(p.avatarUrl, true), division: p.division, sort: Math.max(-9999, Math.min(9999, Number(p.sort) || 0)) };
      if (p.action === 'updateRoster') {
        const rows = await db.update(t.rosterMembers).set(fields).where(eq(t.rosterMembers.id, text(p.id))).returning();
        if (!rows.length) throw new HttpError(404, 'Roster entry not found.');
      } else await db.insert(t.rosterMembers).values({ id: randomUUID(), ...fields });
      return c.json({ ok: true });
    }
    case 'addResource': {
      requireRole(me, 'admin');
      if (!text(p.title) || !ROLES.includes(p.minRole)) throw new HttpError(400, 'Add a title and choose a minimum role.');
      if (p.division && !DIVISIONS.includes(p.division)) throw new HttpError(400, 'Choose a valid division.');
      await db.insert(t.resources).values({ id: randomUUID(), title: text(p.title), url: validUrl(p.url), minRole: p.minRole, division: p.division || null }); return c.json({ ok: true });
    }
    case 'announce': {
      requireRole(me, 'admin'); if (!text(p.body, 2000)) throw new HttpError(400, 'Write an announcement first.');
      await db.insert(t.announcements).values({ id: randomUUID(), body: text(p.body, 2000) }); return c.json({ ok: true });
    }
    case 'addTikTok': {
      requireRole(me, 'admin');
      const url = validUrl(p.url), match = new URL(url).pathname.match(/^\/@teamyvo\/video\/(\d+)\/?$/);
      if (new URL(url).hostname !== 'www.tiktok.com' || !match) throw new HttpError(400, 'Use a full video link from @teamyvo.');
      const response = await fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url), { redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new HttpError(400, 'TikTok could not load that video. Try again later.');
      const post = await response.json(), id = match[1];
      const fields = { shareUrl: url, title: text(post.title, 300), coverUrl: validUrl(post.thumbnail_url, true), postedAt: new Date(Number(BigInt(id) >> 32n) * 1000).toISOString() };
      await db.insert(t.tiktokPosts).values({ id, ...fields }).onConflictDoUpdate({ target: t.tiktokPosts.id, set: fields });
      return c.json({ ok: true });
    }
    case 'deleteRoster': case 'deleteResource': case 'deleteAnnouncement': case 'deleteTikTok': {
      requireRole(me, 'admin');
      const table = { deleteRoster: t.rosterMembers, deleteResource: t.resources, deleteAnnouncement: t.announcements, deleteTikTok: t.tiktokPosts }[p.action];
      await db.delete(table).where(eq(table.id, text(p.id))); return c.json({ ok: true });
    }
    default: throw new HttpError(400, 'Unknown action.');
  }
});
app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
  if (error?.cause?.code === '23505' || error?.code === '23505') return c.json({ error: 'That username or invitation already exists.' }, 409);
  // Never echo database queries, credentials, or provider errors to a browser or logs.
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});
return app;
}
