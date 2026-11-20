CREATE TABLE "announcements" (
	"id" text PRIMARY KEY,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_attempts" (
	"key" text PRIMARY KEY,
	"attempts" integer DEFAULT 1 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY,
	"token_hash" text NOT NULL UNIQUE,
	"username" text NOT NULL UNIQUE,
	"role" text NOT NULL,
	"divisions" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY,
	"channel" text NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY,
	"username" text NOT NULL UNIQUE,
	"provider" text DEFAULT 'identity' NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"divisions" text[] DEFAULT '{}'::text[] NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_url" text DEFAULT '' NOT NULL,
	"timeout_until" timestamp with time zone,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" text PRIMARY KEY,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"min_role" text DEFAULT 'member' NOT NULL,
	"division" text
);
--> statement-breakpoint
CREATE TABLE "roster_members" (
	"id" text PRIMARY KEY,
	"display_name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"division" text NOT NULL,
	"avatar_url" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tiktok_posts" (
	"id" text PRIMARY KEY,
	"share_url" text NOT NULL,
	"cover_url" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"posted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "messages_channel_created_idx" ON "messages" ("channel","created_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_profiles_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id");--> statement-breakpoint
-- Preserve the existing owners. Their existing auth provider verifies their login;
-- roles and all website data are managed by Netlify Database from this point on.
INSERT INTO profiles (id, username, provider, role, divisions, display_name, created_at) VALUES
('6831674b-6a88-4c7b-a22d-77c48b0f146d', 'bambuggarl', 'legacy', 'owner', '{}', 'bambuggarl', '2026-11-19T20:56:26.338022Z'),
('963818fc-cb4e-4161-b53e-0e67c0d6f0e5', 'bambugga', 'legacy', 'owner', '{cch,fs,vfx,gfx,staff}', 'bambugga', '2026-11-19T22:48:12.821179Z');
--> statement-breakpoint
INSERT INTO messages (id, channel, user_id, username, body, created_at) VALUES
('legacy-1', 'general', '963818fc-cb4e-4161-b53e-0e67c0d6f0e5', 'bambugga', 'hello', '2026-11-19T22:48:41.202901Z');
