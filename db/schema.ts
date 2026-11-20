import { pgTable, text, timestamp, integer, boolean, jsonb, index } from 'drizzle-orm/pg-core';

export const profiles = pgTable('profiles', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  provider: text('provider').notNull().default('identity'),
  role: text('role').notNull().default('member'),
  divisions: text('divisions').array().notNull().default([]),
  // Organizational title only (owner, co-owner, ...). It never grants any permission.
  rosterTitle: text('roster_title').notNull().default(''),
  // Individually granted feature permissions, assigned only by Website Developers.
  permissions: text('permissions').array().notNull().default([]),
  discordId: text('discord_id').unique(),
  discordUsername: text('discord_username').notNull().default(''),
  displayName: text('display_name').notNull().default(''),
  title: text('title').notNull().default(''),
  bio: text('bio').notNull().default(''),
  avatarUrl: text('avatar_url').notNull().default(''),
  timeoutUntil: timestamp('timeout_until', { withTimezone: true, mode: 'string' }),
  deleted: boolean('deleted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
export const invites = pgTable('invites', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  username: text('username').notNull().unique(),
  role: text('role').notNull(),
  divisions: text('divisions').array().notNull().default([]),
  rosterTitle: text('roster_title').notNull().default(''),
  permissions: text('permissions').array().notNull().default([]),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'string' }),
});
export const rosterMembers = pgTable('roster_members', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  title: text('title').notNull().default(''),
  division: text('division').notNull(),
  rosterTitle: text('roster_title').notNull().default(''),
  avatarUrl: text('avatar_url').notNull().default(''),
  sort: integer('sort').notNull().default(0),
});
export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  channel: text('channel').notNull(),
  userId: text('user_id').notNull().references(() => profiles.id),
  username: text('username').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [index('messages_channel_created_idx').on(t.channel, t.createdAt)]);
export const resources = pgTable('resources', {
  id: text('id').primaryKey(), title: text('title').notNull(), url: text('url').notNull(),
  minRole: text('min_role').notNull().default('member'), division: text('division'),
});
export const announcements = pgTable('announcements', {
  id: text('id').primaryKey(), body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
export const tiktokPosts = pgTable('tiktok_posts', {
  id: text('id').primaryKey(), shareUrl: text('share_url').notNull(),
  coverUrl: text('cover_url').notNull().default(''), title: text('title').notNull().default(''),
  postedAt: timestamp('posted_at', { withTimezone: true, mode: 'string' }).notNull(),
});
export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(), actorId: text('actor_id').notNull(), action: text('action').notNull(),
  targetId: text('target_id'), details: jsonb('details'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
export const claimAttempts = pgTable('claim_attempts', {
  key: text('key').primaryKey(), attempts: integer('attempts').notNull().default(1),
  windowStart: timestamp('window_start', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
export const recoveryTokens = pgTable('recovery_tokens', {
  id: text('id').primaryKey(),
  profileId: text('profile_id').notNull().references(() => profiles.id),
  tokenHash: text('token_hash').notNull().unique(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  // Set when the token is used or replaced by a newer one.
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
}, (t) => [index('recovery_tokens_profile_idx').on(t.profileId)]);
export const oauthStates = pgTable('oauth_states', {
  stateHash: text('state_hash').primaryKey(),
  profileId: text('profile_id').notNull().references(() => profiles.id),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
});
export const recoveryTokens = pgTable('recovery_tokens', {
  id: text('id').primaryKey(),
  profileId: text('profile_id').notNull().references(() => profiles.id),
  tokenHash: text('token_hash').notNull().unique(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  // Set when the token is used or replaced by a newer one.
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
}, (t) => [index('recovery_tokens_profile_idx').on(t.profileId)]);
export const oauthStates = pgTable('oauth_states', {
  stateHash: text('state_hash').primaryKey(),
  profileId: text('profile_id').notNull().references(() => profiles.id),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
});
