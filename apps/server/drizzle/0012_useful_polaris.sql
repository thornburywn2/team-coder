CREATE TABLE IF NOT EXISTS "work_locks" (
	"project_id" uuid,
	"file" text NOT NULL,
	"holder_id" uuid NOT NULL,
	"holder_name" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_locks" ADD CONSTRAINT "work_locks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_work_locks_project_file" ON "work_locks" USING btree ("project_id","file");