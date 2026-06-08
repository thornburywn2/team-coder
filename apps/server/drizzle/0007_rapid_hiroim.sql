ALTER TABLE "adrs" ADD COLUMN "idempotency_key" varchar(128);--> statement-breakpoint
ALTER TABLE "code_patterns" ADD COLUMN "idempotency_key" varchar(128);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_adrs_project_idem" ON "adrs" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_patterns_project_idem" ON "code_patterns" USING btree ("project_id","idempotency_key");