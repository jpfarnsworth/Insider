CREATE TABLE "saved_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"params" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_filters_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "setting_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "rule_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "baseline_revision" integer;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "alerted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "setting_versions_key_version_idx" ON "setting_versions" USING btree ("key","version");