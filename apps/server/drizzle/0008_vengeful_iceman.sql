CREATE TABLE IF NOT EXISTS "feed_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"developer_id" uuid,
	"developer" varchar(100),
	"color" varchar(20),
	"kind" varchar(30) NOT NULL,
	"detail" text,
	"file" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_feed_project" ON "feed_items" USING btree ("project_id","ts");