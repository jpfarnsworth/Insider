CREATE TABLE "market_days" (
	"date" date PRIMARY KEY NOT NULL,
	"open" text NOT NULL,
	"close" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
