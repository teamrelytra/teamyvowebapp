import { and, eq, gt, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { invites, profiles } from '../../db/schema.ts';

const hash = (token) => createHash('sha256').update(token.trim().toUpperCase()).digest('hex');
const cleanUser = (user) => ({
  ...user,
  confirmedAt: user.confirmedAt || new Date().toISOString(),
  userMetadata: { full_name: user.email.split('@')[0] },
  appMetadata: { ...user.appMetadata, roles: ['member'] },
});
const invitation = (user) => and(
  eq(invites.tokenHash, hash(String(user.userMetadata?.activation_token || ''))),
  eq(invites.username, user.email.split('@')[0]),
  isNull(invites.claimedAt), gt(invites.expiresAt, new Date().toISOString()),
);

export const createIdentityHandlers = db => ({
  async userValidate(event) {
    if (!event.user.email?.endsWith('@members.yvo.team')) return event.deny();
    const [invite] = await db.select().from(invites).where(invitation(event.user)).limit(1);
    if (!invite) return event.deny();
    return { user: { ...event.user, confirmedAt: new Date().toISOString() } };
  },
  async userSignup(event) {
    try {
      await db.transaction(async tx => {
        const [invite] = await tx.update(invites).set({ claimedAt: new Date().toISOString() })
          .where(invitation(event.user)).returning();
        if (!invite) throw new Error('Invalid invitation');
        await tx.insert(profiles).values({
          id: event.user.id, username: invite.username, role: invite.role,
          divisions: invite.divisions, displayName: invite.username,
        });
      });
      return { user: cleanUser(event.user) };
    } catch { return event.deny(); }
  },
  async userLogin(event) {
    const [profile] = await db.select({ deleted: profiles.deleted }).from(profiles).where(eq(profiles.id, event.user.id));
    if (!profile || profile.deleted) return event.deny();
  },
});
