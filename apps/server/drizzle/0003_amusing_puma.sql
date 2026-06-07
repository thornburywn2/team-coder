CREATE TYPE "public"."task_source" AS ENUM('manual', 'prd');--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source" "task_source" DEFAULT 'manual' NOT NULL;