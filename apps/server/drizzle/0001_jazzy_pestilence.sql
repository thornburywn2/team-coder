CREATE TABLE IF NOT EXISTS "git_commits" (
	"sha" text PRIMARY KEY NOT NULL,
	"developer_id" uuid,
	"author_name" text,
	"author_email" text,
	"message" text,
	"committed_at" timestamp with time zone,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "git_file_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha" text NOT NULL,
	"developer_id" uuid,
	"file_path" text NOT NULL,
	"module_id" uuid,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "git_commits" ADD CONSTRAINT "git_commits_developer_id_users_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "git_file_changes" ADD CONSTRAINT "git_file_changes_sha_git_commits_sha_fk" FOREIGN KEY ("sha") REFERENCES "public"."git_commits"("sha") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "git_file_changes" ADD CONSTRAINT "git_file_changes_developer_id_users_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "git_file_changes" ADD CONSTRAINT "git_file_changes_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_git_commits_dev" ON "git_commits" USING btree ("developer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_git_commits_ts" ON "git_commits" USING btree ("committed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gfc_dev" ON "git_file_changes" USING btree ("developer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gfc_file" ON "git_file_changes" USING btree ("file_path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gfc_module" ON "git_file_changes" USING btree ("module_id");