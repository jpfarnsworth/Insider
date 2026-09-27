CREATE TABLE "prereg_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" text NOT NULL,
	"n" integer NOT NULL,
	"signal_ids" jsonb NOT NULL,
	"estimate" numeric(14, 6) NOT NULL,
	"lo" numeric(14, 6) NOT NULL,
	"hi" numeric(14, 6) NOT NULL,
	"status" text NOT NULL,
	"bootstraps" integer NOT NULL,
	"seed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prereg_results_test_id_unique" UNIQUE("test_id")
);
