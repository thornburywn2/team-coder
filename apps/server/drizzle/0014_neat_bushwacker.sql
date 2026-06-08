DROP TABLE "activity_events" CASCADE;--> statement-breakpoint
ALTER TABLE "code_patterns" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
DROP TYPE "public"."event_action";