import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { and, eq, desc, asc, gt, isNull, sql } from 'drizzle-orm';
import * as t from '../../db/schema.ts';
import {
  DIVISIONS, ROLES, ROSTER_GROUPS, TITLE_DIVISION, DEVELOPER, rank, HttpError, can, isDeveloper, effectivePermissions,
  requireRole, requireDeveloper, requirePermission, requireManager, requireChannel, requireCanMessage, requireCanModerate,
  requireProfileEdit, cleanPermissions, cleanRosterTitle, publicProfile, selfProfile, managerProfile,
} from './permissions.mjs';

const RECOVERY_HOURS = 24;
const PASSWORD_RULE = 'Use a password of 8 to 128 characters.';

// Sets a password on the sign-in provider. Passwords are never stored by this app.
function providerPasswords(legacy) {
  return {
    supports: profile => profile.provider !== 'legacy' || !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    async set(profile, password) {
      if (profile.provider === 'legacy') {
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!key) throw new HttpError(503, 'Resets for this older account are not configured yet.');
        const response = await fetch(legacy.SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(profile.id), {
          method: 'PUT', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }), signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new HttpError(502, 'Could not update the password. Please try again.');
        return;
      }
      try { const { admin } = await import('@netlify/identity'); await admin.updateUser(profile.id, { password }); }
      catch { throw new HttpError(502, 'Could not update the password. Please try again.'); }
    },
  };
}

export function createApp({ database, authenticateUser = null, passwords = null, fetchImpl = fetch }) {
const db = database;
// Keep the two existing accounts working. All authorization and application data now live here.
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(new URL('../../public/config.js', import.meta.url), 'utf8'), sandbox);
const legacy = sandbox.window.YVO;
const app = new Hono();
const allowedOrigins = new Set(['https://teamyvo.netlify.app', ...['URL', 'DEPLOY_URL', 'DEPLOY_PRIME_URL'].map(key => process.env[key]).filter(Boolean)].map(value => new URL(value).origin));
if (process.env.NETLIFY_DEV === 'true') { allowedOrigins.add('http://localhost:8889'); allowedOrigins.add('http://127.0.0.1:8889'); }
const sha = value => createHash('sha256').update(String(value)).digest('hex');
const sameSecret = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const hash = value => createHash('sha256').update(value.trim().toUpperCase()).digest('hex');
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const listDivisions = value => [...new Set(Array.isArray(value) ? value : [])].filter(d => DIVISIONS.includes(d));
const validUrl = (value, optional = false) => {
  if (!value && optional) return '';
  try { const u = new URL(value); if (!['https:', 'http:'].includes(u.protocol)) throw 0; return u.href; }
  catch { throw new HttpError(400, 'Enter a valid http or https URL.'); }
};
const profileById = async id => (await db.select().from(t.profiles).where(eq(t.profiles.id, text(id))).limit(1))[0];
const audit = (tx, actor, action, targetId = null, details = null) => tx.insert(t.auditLog).values({
  id: randomUUID(), actorId: actor.id, action, targetId, details,
});
const sameSet = (a = [], b = []) => a.length === b.length && a.every(x => b.includes(x));
passwords ??= providerPasswords(legacy);
const primaryOrigin = () => new URL(process.env.URL || 'https://teamyvo.netlify.app').origin;
// Discord credentials stay in server environment variables and are never sent to the browser.
const discordConfig = () => {
  const id = process.env.DISCORD_CLIENT_ID, secret = process.env.DISCORD_CLIENT_SECRET;
  return id && secret ? { id, secret, redirect: process.env.DISCORD_REDIRECT_URI || primaryOrigin() + '/api/discord/callback' } : null;
};

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

app.get('/api/me', async c => { const me = await authenticate(c); return c.json({ me: me ? selfProfile(me) : null }); });

// Failed activations are limited persistently, across cold starts and instances.
async function limitClaims(c) {
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
}
app.post('/api/prepare-claim', async c => {
  const { token } = await c.req.json();
  if (typeof token !== 'string' || token.length > 100) throw new HttpError(400, 'Enter your activation token.');
  await limitClaims(c);
  const [invite] = await db.select().from(t.invites).where(and(
    eq(t.invites.tokenHash, hash(token)), isNull(t.invites.claimedAt), gt(t.invites.expiresAt, new Date().toISOString()),
  )).limit(1);
  if (invite) return c.json({ username: invite.username, mode: 'activate' });
  const [recovery] = await db.select({ username: t.profiles.username }).from(t.recoveryTokens)
    .innerJoin(t.profiles, eq(t.profiles.id, t.recoveryTokens.profileId)).where(and(
      eq(t.recoveryTokens.tokenHash, hash(token)), isNull(t.recoveryTokens.usedAt),
      gt(t.recoveryTokens.expiresAt, new Date().toISOString()), eq(t.profiles.deleted, false),
    )).limit(1);
  if (!recovery) throw new HttpError(400, 'Invalid or expired activation token.');
  return c.json({ username: recovery.username, mode: 'recover' });
});

// Reactivates an EXISTING account with a single-use recovery token: same username, roster entry and data.
app.post('/api/complete-recovery', async c => {
  const { token, password } = await c.req.json();
  if (typeof token !== 'string' || token.length > 100) throw new HttpError(400, 'Enter your activation token.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new HttpError(400, PASSWORD_RULE);
  await limitClaims(c);
  const username = await db.transaction(async tx => {
    // Consuming the token first makes concurrent redemptions impossible; a failure below rolls this back.
    const [used] = await tx.update(t.recoveryTokens).set({ usedAt: new Date().toISOString() }).where(and(
      eq(t.recoveryTokens.tokenHash, hash(token)), isNull(t.recoveryTokens.usedAt), gt(t.recoveryTokens.expiresAt, new Date().toISOString()),
    )).returning();
    if (!used) throw new HttpError(400, 'Invalid or expired activation token.');
    const [profile] = await tx.select().from(t.profiles).where(eq(t.profiles.id, used.profileId)).for('update');
    if (!profile || profile.deleted) throw new HttpError(400, 'Invalid or expired activation token.');
    await passwords.set(profile, password);
    await audit(tx, profile, 'accountRecovered', profile.id);
    return profile.username;
  });
  return c.json({ ok: true, username });
});

// Discord OAuth2 callback. The user is identified by a single-use state bound to a browser cookie.
app.get('/api/discord/callback', async c => {
  const cookieOptions = { path: '/api/discord', secure: true, httpOnly: true, sameSite: 'Lax' };
  const finish = status => { deleteCookie(c, 'yvo_discord_state', cookieOptions); return c.redirect('/?discord=' + status + '#/hub', 302); };
  const cfg = discordConfig(), { code, state, error } = c.req.query(), cookie = getCookie(c, 'yvo_discord_state');
  if (!cfg) return finish('error');
  if (typeof state !== 'string' || state.length > 200 || !cookie || !sameSecret(cookie, state)) return finish('invalid');
  const [row] = await db.update(t.oauthStates).set({ usedAt: new Date().toISOString() }).where(and(
    eq(t.oauthStates.stateHash, sha(state)), isNull(t.oauthStates.usedAt), gt(t.oauthStates.expiresAt, new Date().toISOString()),
  )).returning();
  if (!row) return finish('invalid');
  if (error) return finish('denied');
  if (typeof code !== 'string' || !code || code.length > 512) return finish('invalid');
  try {
    const basic = Buffer.from(cfg.id + ':' + cfg.secret).toString('base64');
    const tokenResponse = await fetchImpl('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + basic },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirect }), signal: AbortSignal.timeout(8000),
    });
    if (!tokenResponse.ok) return finish('error');
    const { access_token: accessToken } = await tokenResponse.json();
    if (typeof accessToken !== 'string') return finish('error');
    const userResponse = await fetchImpl('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + accessToken }, signal: AbortSignal.timeout(8000) });
    // The token is only needed once; revoke it on a best-effort basis.
    fetchImpl('https://discord.com/api/oauth2/token/revoke', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + basic },
      body: new URLSearchParams({ token: accessToken, token_type_hint: 'access_token' }), signal: AbortSignal.timeout(5000),
    }).catch(() => {});
    if (!userResponse.ok) return finish('error');
    const account = await userResponse.json();
    if (!/^\d{15,25}$/.test(String(account.id))) return finish('error');
    const username = text(account.username, 80);
    return await db.transaction(async tx => {
      const [profile] = await tx.select().from(t.profiles).where(eq(t.profiles.id, row.profileId)).for('update');
      if (!profile || profile.deleted) return finish('invalid');
      if (profile.discordId && profile.discordId !== account.id) return finish('already-linked');
      const [owner] = await tx.select({ id: t.profiles.id }).from(t.profiles).where(eq(t.profiles.discordId, account.id));
      if (owner && owner.id !== profile.id) return finish('duplicate');
      await tx.update(t.profiles).set({ discordId: account.id, discordUsername: username }).where(eq(t.profiles.id, profile.id));
      await audit(tx, profile, 'discordLinked', profile.id);
      return finish('linked');
    });
  } catch (e) { return finish(e?.cause?.code === '23505' || e?.code === '23505' ? 'duplicate' : 'error'); }
});

app.use('/api/action', async (c, next) => { c.set('me', await authenticate(c)); requireRole(c.get('me'), 'member'); await next(); });
app.post('/api/action', async c => {
  const p = await c.req.json(), me = c.get('me');
  switch (p.action) {
    case 'hubData': {
      const [resources, announcements, moderationMembers] = await Promise.all([
        db.select().from(t.resources).orderBy(t.resources.title),
        db.select().from(t.announcements).orderBy(desc(t.announcements.createdAt)).limit(5),
        can(me, 'chat.moderate') ? db.select({ id: t.profiles.id, username: t.profiles.username, role: t.profiles.role, timeoutUntil: t.profiles.timeoutUntil }).from(t.profiles).where(eq(t.profiles.deleted, false)).orderBy(t.profiles.username) : [],
      ]);
      return c.json({ resources: resources.filter(r => rank(me.role) >= rank(r.minRole) && (!r.division || can(me, 'divisions.all') || me.divisions.includes(r.division))), announcements, moderationMembers, me: selfProfile(me) });
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
      requirePermission(me, 'chat.moderate');
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
      requireManager(me);
      const dev = isDeveloper(me), none = Promise.resolve([]);
      const [members, roster, resources, announcements, posts, invites] = await Promise.all([
        can(me, 'roster.manage') ? db.select().from(t.profiles).where(eq(t.profiles.deleted, false)).orderBy(t.profiles.username) : none,
        can(me, 'roster.manage') ? db.select().from(t.rosterMembers).orderBy(t.rosterMembers.sort, t.rosterMembers.displayName) : none,
        can(me, 'vault.manage') ? db.select().from(t.resources) : none,
        can(me, 'announcements.manage') ? db.select().from(t.announcements).orderBy(desc(t.announcements.createdAt)) : none,
        can(me, 'tiktok.manage') ? db.select().from(t.tiktokPosts).orderBy(desc(t.tiktokPosts.postedAt)) : none,
        dev ? db.select({ id: t.invites.id, username: t.invites.username, role: t.invites.role, rosterTitle: t.invites.rosterTitle, permissions: t.invites.permissions, divisions: t.invites.divisions, expiresAt: t.invites.expiresAt }).from(t.invites).where(and(isNull(t.invites.claimedAt), gt(t.invites.expiresAt, new Date().toISOString()))) : none,
      ]);
      return c.json({ members: members.map(m => managerProfile(m, me)), roster, resources, announcements, posts, invites, can: effectivePermissions(me) });
    }
    case 'createInvite': {
      requireDeveloper(me);
      const username = text(p.username).toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new HttpError(400, 'Username must be 3–20 letters, numbers or underscores.');
      if (!ROLES.includes(p.role)) throw new HttpError(400, 'Choose a valid role.');
      const [existing] = await db.select({ id: t.profiles.id }).from(t.profiles).where(eq(t.profiles.username, username));
      if (existing) throw new HttpError(409, 'That username is already taken.');
      const rosterTitle = cleanRosterTitle(p.rosterTitle), permissions = cleanPermissions(p.permissions ?? []);
      const token = 'YVO-' + randomBytes(16).toString('hex').toUpperCase();
      await db.insert(t.invites).values({ id: randomUUID(), tokenHash: hash(token), username, role: p.role, rosterTitle, permissions, divisions: listDivisions(p.divisions), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() });
      return c.json({ username, token });
    }
    case 'deleteInvite': {
      requireDeveloper(me); await db.delete(t.invites).where(eq(t.invites.id, text(p.id))); return c.json({ ok: true });
    }
    case 'updateProfile': {
      const target = await profileById(p.id), nextRole = p.role ?? target?.role;
      requireProfileEdit(me, target, nextRole);
      // Roster titles and explicit permissions are separate from roles, and only Website Developers can change them.
      const nextTitle = p.rosterTitle === undefined ? target.rosterTitle : cleanRosterTitle(p.rosterTitle);
      const nextPermissions = p.permissions === undefined ? target.permissions : cleanPermissions(p.permissions);
      if (nextTitle !== target.rosterTitle || !sameSet(nextPermissions, target.permissions)) requireDeveloper(me);
      await db.transaction(async tx => {
        // Serialize developer-role changes so two requests cannot remove every Website Developer.
        const developers = await tx.select().from(t.profiles).where(and(eq(t.profiles.role, DEVELOPER), eq(t.profiles.deleted, false))).for('update');
        if (target.role === DEVELOPER && nextRole !== DEVELOPER && developers.length <= 1) throw new HttpError(400, 'Keep at least one Website Developer.');
        await tx.update(t.profiles).set({ displayName: text(p.displayName, 50) || target.username, title: text(p.title, 80), bio: text(p.bio, 500), avatarUrl: validUrl(p.avatarUrl, true), divisions: listDivisions(p.divisions), role: nextRole, rosterTitle: nextTitle, permissions: nextPermissions }).where(eq(t.profiles.id, target.id));
        const accessChanged = nextRole !== target.role || nextTitle !== target.rosterTitle || !sameSet(nextPermissions, target.permissions);
        await audit(tx, me, accessChanged ? 'updateAccess' : 'updateProfile', target.id, accessChanged ? { role: nextRole, rosterTitle: nextTitle, permissions: nextPermissions } : null);
      });
      return c.json({ ok: true });
    }
    case 'resetAccount': {
      requireDeveloper(me);
      const target = await profileById(p.id);
      if (!target || target.deleted) throw new HttpError(404, 'Member not found.');
      if (target.id === me.id) throw new HttpError(400, 'Change your own password in Settings.');
      if (!passwords.supports(target)) throw new HttpError(503, 'Resets for this older account are not configured yet. Add SUPABASE_SERVICE_ROLE_KEY in the site settings.');
      const token = 'YVR-' + randomBytes(16).toString('hex').toUpperCase();
      const expiresAt = new Date(Date.now() + RECOVERY_HOURS * 3600000).toISOString();
      await db.transaction(async tx => {
        await tx.select({ id: t.profiles.id }).from(t.profiles).where(eq(t.profiles.id, target.id)).for('update');
        // Every earlier unused token for this account stops working.
        await tx.update(t.recoveryTokens).set({ usedAt: new Date().toISOString() }).where(and(eq(t.recoveryTokens.profileId, target.id), isNull(t.recoveryTokens.usedAt)));
        await tx.insert(t.recoveryTokens).values({ id: randomUUID(), profileId: target.id, tokenHash: hash(token), createdBy: me.id, expiresAt });
        await audit(tx, me, 'resetAccount', target.id, { expiresAt });
      });
      return c.json({ username: target.username, token, expiresAt, reset: true });
    }
    case 'discordStart': {
      const cfg = discordConfig();
      if (!cfg) throw new HttpError(503, 'Discord linking is not set up yet.');
      const state = randomBytes(32).toString('hex');
      await db.delete(t.oauthStates).where(sql`${t.oauthStates.expiresAt} < now() - interval '1 hour'`);
      await db.insert(t.oauthStates).values({ stateHash: sha(state), profileId: me.id, expiresAt: new Date(Date.now() + 10 * 60000).toISOString() });
      setCookie(c, 'yvo_discord_state', state, { path: '/api/discord', secure: true, httpOnly: true, sameSite: 'Lax', maxAge: 600 });
      const url = new URL('https://discord.com/oauth2/authorize');
      for (const [k, v] of Object.entries({ response_type: 'code', client_id: cfg.id, scope: 'identify', redirect_uri: cfg.redirect, state, prompt: 'consent' })) url.searchParams.set(k, v);
      return c.json({ url: url.href });
    }
    case 'discordDisconnect': {
      await db.transaction(async tx => {
        await tx.update(t.profiles).set({ discordId: null, discordUsername: '' }).where(eq(t.profiles.id, me.id));
        await audit(tx, me, 'discordUnlinked', me.id);
      });
      return c.json({ ok: true });
    }
    case 'deleteMember': {
      requireDeveloper(me); const target = await profileById(p.id);
      if (!target || target.deleted) throw new HttpError(404, 'Member not found.');
      if (target.id === me.id) throw new HttpError(400, 'You cannot delete your own account.');
      await db.transaction(async tx => {
        const developers = await tx.select().from(t.profiles).where(and(eq(t.profiles.role, DEVELOPER), eq(t.profiles.deleted, false))).for('update');
        if (target.role === DEVELOPER && developers.length <= 1) throw new HttpError(400, 'Keep at least one Website Developer.');
        await tx.delete(t.messages).where(eq(t.messages.userId, target.id));
        // A tombstone rejects existing sessions and prevents legacy accounts from reappearing.
        await tx.update(t.profiles).set({ deleted: true, displayName: '', title: '', bio: '', avatarUrl: '', divisions: [], role: 'member', rosterTitle: '', permissions: [], discordId: null, discordUsername: '', timeoutUntil: null }).where(eq(t.profiles.id, target.id));
        await tx.delete(t.recoveryTokens).where(eq(t.recoveryTokens.profileId, target.id));
        await tx.delete(t.oauthStates).where(eq(t.oauthStates.profileId, target.id));
        await tx.delete(t.invites).where(eq(t.invites.username, target.username));
        await audit(tx, me, 'deleteMember', target.id);
      });
      return c.json({ ok: true });
    }
    case 'addRoster': case 'updateRoster': {
      requirePermission(me, 'roster.manage');
      if (!ROSTER_GROUPS.includes(p.division) || !text(p.displayName)) throw new HttpError(400, 'Add a name and choose a roster group.');
      const rosterTitle = cleanRosterTitle(p.rosterTitle);
      if (rosterTitle && TITLE_DIVISION[rosterTitle] !== p.division) throw new HttpError(400, 'That title does not belong to the chosen roster group.');
      const fields = { rosterTitle, displayName: text(p.displayName, 50), title: text(p.title, 80), avatarUrl: validUrl(p.avatarUrl, true), division: p.division, sort: Math.max(-9999, Math.min(9999, Number(p.sort) || 0)) };
      if (p.action === 'updateRoster') {
        const rows = await db.update(t.rosterMembers).set(fields).where(eq(t.rosterMembers.id, text(p.id))).returning();
        if (!rows.length) throw new HttpError(404, 'Roster entry not found.');
      } else await db.insert(t.rosterMembers).values({ id: randomUUID(), ...fields });
      return c.json({ ok: true });
    }
    case 'addResource': {
      requirePermission(me, 'vault.manage');
      if (!text(p.title) || !ROLES.includes(p.minRole)) throw new HttpError(400, 'Add a title and choose a minimum role.');
      if (p.division && !DIVISIONS.includes(p.division)) throw new HttpError(400, 'Choose a valid division.');
      await db.insert(t.resources).values({ id: randomUUID(), title: text(p.title), url: validUrl(p.url), minRole: p.minRole, division: p.division || null }); return c.json({ ok: true });
    }
    case 'announce': {
      requirePermission(me, 'announcements.manage'); if (!text(p.body, 2000)) throw new HttpError(400, 'Write an announcement first.');
      await db.insert(t.announcements).values({ id: randomUUID(), body: text(p.body, 2000) }); return c.json({ ok: true });
    }
    case 'addTikTok': {
      requirePermission(me, 'tiktok.manage');
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
      requirePermission(me, { deleteRoster: 'roster.manage', deleteResource: 'vault.manage', deleteAnnouncement: 'announcements.manage', deleteTikTok: 'tiktok.manage' }[p.action]);
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
