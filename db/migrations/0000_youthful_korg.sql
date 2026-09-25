CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "filing_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filing_id" uuid NOT NULL,
	"insider_cik" text NOT NULL,
	"is_director" boolean DEFAULT false NOT NULL,
	"is_officer" boolean DEFAULT false NOT NULL,
	"officer_title" text,
	"is_ten_pct_owner" boolean DEFAULT false NOT NULL,
	"is_other" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accession_no" text NOT NULL,
	"form_type" text NOT NULL,
	"issuer_cik" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"filed_at" date NOT NULL,
	"url" text NOT NULL,
	"is_amendment" boolean DEFAULT false NOT NULL,
	"amends_accession_no" text,
	"raw_xml" text,
	"parse_status" text DEFAULT 'pending' NOT NULL,
	"parse_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filings_accession_no_unique" UNIQUE("accession_no")
);
--> statement-breakpoint
CREATE TABLE "insiders" (
	"cik" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issuers" (
	"cik" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ticker" text,
	"exchange" text,
	"sector" text,
	"industry" text,
	"market_cap" numeric(20, 2),
	"market_cap_as_of" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filing_id" uuid NOT NULL,
	"insider_cik" text NOT NULL,
	"issuer_cik" text NOT NULL,
	"security_title" text NOT NULL,
	"is_derivative" boolean DEFAULT false NOT NULL,
	"transaction_date" date NOT NULL,
	"code" text NOT NULL,
	"shares" numeric(20, 4),
	"price" numeric(20, 4),
	"value" numeric(24, 4) GENERATED ALWAYS AS (shares * price) STORED,
	"acquired_disposed" text,
	"shares_owned_after" numeric(20, 4),
	"ownership" text,
	"is_10b5_1" boolean DEFAULT false NOT NULL,
	"footnotes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_qualifying" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_bundle" jsonb NOT NULL,
	"output" jsonb,
	"score" integer,
	"conviction" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"latency_ms" integer,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer_cik" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"insider_count" integer NOT NULL,
	"total_value" numeric(24, 4) NOT NULL,
	"first_qualified_at" timestamp with time zone,
	"trigger_filing_id" uuid,
	"rule_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"horizon_days" integer NOT NULL,
	"exit_date" date,
	"exit_price" numeric(20, 4),
	"return_pct" numeric(12, 6),
	"benchmark_ticker" text DEFAULT 'SPY' NOT NULL,
	"benchmark_return_pct" numeric(12, 6),
	"excess_return_pct" numeric(12, 6),
	"max_drawdown_pct" numeric(12, 6),
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"issuer_cik" text NOT NULL,
	"signal_at" timestamp with time zone NOT NULL,
	"entry_date" date,
	"entry_price" numeric(20, 4),
	"baseline_score" numeric(5, 2),
	"baseline_version" integer,
	"latest_agent_eval_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_cluster_id_unique" UNIQUE("cluster_id")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_bars" (
	"ticker" text NOT NULL,
	"date" date NOT NULL,
	"open" numeric(20, 4) NOT NULL,
	"high" numeric(20, 4) NOT NULL,
	"low" numeric(20, 4) NOT NULL,
	"close" numeric(20, 4) NOT NULL,
	"adj_close" numeric(20, 4) NOT NULL,
	"volume" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_bars_ticker_date_pk" PRIMARY KEY("ticker","date")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer_cik" text NOT NULL,
	"note" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_issuer_cik_unique" UNIQUE("issuer_cik")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing_owners" ADD CONSTRAINT "filing_owners_filing_id_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."filings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing_owners" ADD CONSTRAINT "filing_owners_insider_cik_insiders_cik_fk" FOREIGN KEY ("insider_cik") REFERENCES "public"."insiders"("cik") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_issuer_cik_issuers_cik_fk" FOREIGN KEY ("issuer_cik") REFERENCES "public"."issuers"("cik") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_filing_id_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."filings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_insider_cik_insiders_cik_fk" FOREIGN KEY ("insider_cik") REFERENCES "public"."insiders"("cik") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_issuer_cik_issuers_cik_fk" FOREIGN KEY ("issuer_cik") REFERENCES "public"."issuers"("cik") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evaluations" ADD CONSTRAINT "agent_evaluations_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_events" ADD CONSTRAINT "cluster_events_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_transactions" ADD CONSTRAINT "cluster_transactions_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_transactions" ADD CONSTRAINT "cluster_transactions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_issuer_cik_issuers_cik_fk" FOREIGN KEY ("issuer_cik") REFERENCES "public"."issuers"("cik") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_trigger_filing_id_filings_id_fk" FOREIGN KEY ("trigger_filing_id") REFERENCES "public"."filings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_outcomes" ADD CONSTRAINT "signal_outcomes_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_issuer_cik_issuers_cik_fk" FOREIGN KEY ("issuer_cik") REFERENCES "public"."issuers"("cik") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_issuer_cik_issuers_cik_fk" FOREIGN KEY ("issuer_cik") REFERENCES "public"."issuers"("cik") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "filing_owners_filing_id_idx" ON "filing_owners" USING btree ("filing_id");--> statement-breakpoint
CREATE INDEX "filings_accepted_at_idx" ON "filings" USING btree ("accepted_at");--> statement-breakpoint
CREATE INDEX "filings_issuer_cik_idx" ON "filings" USING btree ("issuer_cik");--> statement-breakpoint
CREATE INDEX "filings_parse_status_idx" ON "filings" USING btree ("parse_status");--> statement-breakpoint
CREATE INDEX "transactions_issuer_date_idx" ON "transactions" USING btree ("issuer_cik","transaction_date");--> statement-breakpoint
CREATE INDEX "transactions_insider_idx" ON "transactions" USING btree ("insider_cik");--> statement-breakpoint
CREATE INDEX "transactions_filing_id_idx" ON "transactions" USING btree ("filing_id");--> statement-breakpoint
CREATE INDEX "agent_evaluations_signal_id_idx" ON "agent_evaluations" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "cluster_events_cluster_id_idx" ON "cluster_events" USING btree ("cluster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_transactions_unique" ON "cluster_transactions" USING btree ("cluster_id","transaction_id");--> statement-breakpoint
CREATE INDEX "clusters_issuer_cik_idx" ON "clusters" USING btree ("issuer_cik");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_outcomes_signal_horizon_bench_unique" ON "signal_outcomes" USING btree ("signal_id","horizon_days","benchmark_ticker");--> statement-breakpoint
CREATE INDEX "signals_signal_at_idx" ON "signals" USING btree ("signal_at");--> statement-breakpoint
CREATE INDEX "job_runs_job_started_idx" ON "job_runs" USING btree ("job_name","started_at");