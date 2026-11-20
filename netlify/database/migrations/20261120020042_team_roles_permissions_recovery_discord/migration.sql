CREATE TABLE "oauth_states" (
	"state_hash" text PRIMARY KEY,
	"profile_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recovery_tokens" (
	"id" text PRIMARY KEY,
	"profile_id" text NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "roster_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "roster_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "discord_id" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "discord_username" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_members" ADD COLUMN "roster_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_discord_id_key" UNIQUE("discord_id");--> statement-breakpoint
CREATE INDEX "recovery_tokens_profile_idx" ON "recovery_tokens" ("profile_id");--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_profile_id_profiles_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id");--> statement-breakpoint
ALTER TABLE "recovery_tokens" ADD CONSTRAINT "recovery_tokens_profile_id_profiles_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id");--> statement-breakpoint
-- DATA MIGRATION (no rows are deleted). Roster titles are organizational only and grant nothing.
-- Keep each person's current roster appearance by recording the old role as their roster title first.
UPDATE "profiles" SET "roster_title" = "role" WHERE "role" IN ('owner', 'co-owner', 'admin') AND "roster_title" = '';--> statement-breakpoint
UPDATE "invites" SET "roster_title" = "role" WHERE "role" IN ('owner', 'co-owner', 'admin') AND "roster_title" = '';--> statement-breakpoint
-- Owner becomes Website Developer (highest system role). Co-Owner is removed as a system role;
-- existing co-owner accounts keep their previous admin-level access and keep Co-Owner as a roster title.
UPDATE "profiles" SET "role" = 'website-developer' WHERE "role" = 'owner';--> statement-breakpoint
UPDATE "profiles" SET "role" = 'admin' WHERE "role" = 'co-owner';--> statement-breakpoint
UPDATE "invites" SET "role" = 'website-developer' WHERE "role" = 'owner';--> statement-breakpoint
UPDATE "invites" SET "role" = 'admin' WHERE "role" = 'co-owner';--> statement-breakpoint
UPDATE "resources" SET "min_role" = 'website-developer' WHERE "min_role" = 'owner';--> statement-breakpoint
UPDATE "resources" SET "min_role" = 'admin' WHERE "min_role" = 'co-owner';--> statement-breakpoint
-- Roster groups become Leadership / Administration / Staff (plus the existing content divisions).
UPDATE "roster_members" SET "roster_title" = "division", "division" = 'leadership' WHERE "division" IN ('owner', 'co-owner');--> statement-breakpoint
UPDATE "roster_members" SET "roster_title" = 'admin', "division" = 'administration' WHERE "division" = 'admin';
