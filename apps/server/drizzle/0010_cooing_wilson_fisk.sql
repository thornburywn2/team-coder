ALTER TABLE "sessions" ADD COLUMN "cache_read_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "cache_creation_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "git_emails" text[] DEFAULT '{}'::text[] NOT NULL;