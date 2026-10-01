CREATE TYPE "public"."analysis_status" AS ENUM('queued', 'resolving', 'building', 'extracting', 'predicting', 'done', 'error');--> statement-breakpoint
CREATE TYPE "public"."build_status" AS ENUM('ok', 'failed', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."import_kind" AS ENUM('full', 'typical', 'subpath', 'custom');--> statement-breakpoint
CREATE TYPE "public"."package_status" AS ENUM('candidate', 'included', 'excluded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."placement" AS ENUM('initial', 'lazy');--> statement-breakpoint
CREATE TYPE "public"."project_mode" AS ENUM('quick', 'full');--> statement-breakpoint
CREATE TYPE "public"."run_arm" AS ENUM('a', 'b');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('ab', 'aa', 'iso');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('queued', 'running', 'ok', 'failed', 'aborted', 'invalid');--> statement-breakpoint
CREATE TABLE "analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"candidates" jsonb NOT NULL,
	"budget" jsonb,
	"status" "analysis_status" DEFAULT 'queued' NOT NULL,
	"status_reason" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_app_id" uuid NOT NULL,
	"import_spec_id" uuid,
	"build_key" text NOT NULL,
	"bundler" text NOT NULL,
	"bundler_version" text NOT NULL,
	"min_bytes" integer NOT NULL,
	"gz_bytes" integer NOT NULL,
	"br_bytes" integer NOT NULL,
	"modules" integer,
	"package_bytes" jsonb,
	"resolved_deps" jsonb,
	"metafile_uri" text,
	"status" "build_status" DEFAULT 'ok' NOT NULL,
	"status_reason" text,
	"build_ms" integer,
	"install_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_app_id" uuid NOT NULL,
	"import_spec_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"vector" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_app" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"framework" text NOT NULL,
	"bundler" text DEFAULT 'vite' NOT NULL,
	"repo_url" text,
	"commit_sha" text,
	"fingerprint" text,
	"baseline_min_bytes" integer,
	"baseline_brotli_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_app_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "import_spec" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"kind" "import_kind" NOT NULL,
	"code" text NOT NULL,
	"sink_expr" text,
	"placement" "placement" DEFAULT 'initial' NOT NULL,
	"human_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"estimate" double precision NOT NULL,
	"ci_low" double precision NOT NULL,
	"ci_high" double precision NOT NULL,
	"n_valid" integer NOT NULL,
	"baseline_median" double precision,
	"within_noise" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"harness_id" text NOT NULL,
	"hostname" text NOT NULL,
	"cpu_model" text NOT NULL,
	"cpus" integer NOT NULL,
	"os" text NOT NULL,
	"chromium_version" text NOT NULL,
	"playwright_version" text,
	"node_version" text,
	"calibration" jsonb NOT NULL,
	"machine_index" integer,
	"warnings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_harness_id_unique" UNIQUE("harness_id")
);
--> statement-breakpoint
CREATE TABLE "model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"dataset_hash" text NOT NULL,
	"git_sha" text NOT NULL,
	"schema_version" integer NOT NULL,
	"metrics" jsonb,
	"artifact_uri" text NOT NULL,
	"current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "package" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"tarball_sha" text,
	"unpacked_bytes" integer,
	"module_format" text,
	"side_effects" text,
	"deps" jsonb,
	"peer_deps" jsonb,
	"published_at" timestamp with time zone,
	"weekly_downloads" integer,
	"category" text,
	"status" "package_status" DEFAULT 'candidate' NOT NULL,
	"status_reason" text,
	"alternative_group" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"candidate_idx" integer NOT NULL,
	"model_id" uuid NOT NULL,
	"metric" text DEFAULT 'scriptThread' NOT NULL,
	"point" double precision NOT NULL,
	"p10" double precision NOT NULL,
	"p90" double precision NOT NULL,
	"contributions" jsonb,
	"out_of_distribution" boolean DEFAULT false NOT NULL,
	"verified_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"target_slowdown" double precision NOT NULL,
	"rtt_ms" integer NOT NULL,
	"down_kbps" integer NOT NULL,
	"calibration_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" "project_mode" NOT NULL,
	"manifest_hash" text NOT NULL,
	"framework" text,
	"storage_uri" text,
	"expires_at" timestamp with time zone,
	"contribute_opt_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"arm" "run_arm" NOT NULL,
	"pair_index" integer NOT NULL,
	"order_ab" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"trace_uri" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_app_id" uuid NOT NULL,
	"import_spec_id" uuid,
	"profile_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"baseline_build_id" uuid,
	"treatment_build_id" uuid,
	"kind" "session_kind" NOT NULL,
	"cell_key" text NOT NULL,
	"k_pairs" integer NOT NULL,
	"seed" integer NOT NULL,
	"cpu_rate" double precision NOT NULL,
	"calibration_before_ms" double precision,
	"calibration_after_ms" double precision,
	"calibration_ref_ms" double precision,
	"delta_min_bytes" integer,
	"delta_gz_bytes" integer,
	"delta_br_bytes" integer,
	"new_packages" jsonb,
	"shared_packages" jsonb,
	"status" "session_status" DEFAULT 'queued' NOT NULL,
	"status_reason" text,
	"invalid_runs" integer DEFAULT 0 NOT NULL,
	"env" jsonb,
	"started_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis" ADD CONSTRAINT "analysis_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis" ADD CONSTRAINT "analysis_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build" ADD CONSTRAINT "build_host_app_id_host_app_id_fk" FOREIGN KEY ("host_app_id") REFERENCES "public"."host_app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build" ADD CONSTRAINT "build_import_spec_id_import_spec_id_fk" FOREIGN KEY ("import_spec_id") REFERENCES "public"."import_spec"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_row" ADD CONSTRAINT "feature_row_host_app_id_host_app_id_fk" FOREIGN KEY ("host_app_id") REFERENCES "public"."host_app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_row" ADD CONSTRAINT "feature_row_import_spec_id_import_spec_id_fk" FOREIGN KEY ("import_spec_id") REFERENCES "public"."import_spec"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_spec" ADD CONSTRAINT "import_spec_package_id_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."package"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_analysis_id_analysis_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analysis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_verified_session_id_session_id_fk" FOREIGN KEY ("verified_session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_host_app_id_host_app_id_fk" FOREIGN KEY ("host_app_id") REFERENCES "public"."host_app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_import_spec_id_import_spec_id_fk" FOREIGN KEY ("import_spec_id") REFERENCES "public"."import_spec"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_baseline_build_id_build_id_fk" FOREIGN KEY ("baseline_build_id") REFERENCES "public"."build"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_treatment_build_id_build_id_fk" FOREIGN KEY ("treatment_build_id") REFERENCES "public"."build"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_project_idx" ON "analysis" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "build_key_uq" ON "build" USING btree ("build_key");--> statement-breakpoint
CREATE INDEX "build_host_idx" ON "build" USING btree ("host_app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_row_uq" ON "feature_row" USING btree ("host_app_id","import_spec_id","schema_version");--> statement-breakpoint
CREATE UNIQUE INDEX "import_spec_uq" ON "import_spec" USING btree ("package_id","code","placement");--> statement-breakpoint
CREATE UNIQUE INDEX "label_uq" ON "label" USING btree ("session_id","metric");--> statement-breakpoint
CREATE INDEX "label_metric_idx" ON "label" USING btree ("metric");--> statement-breakpoint
CREATE UNIQUE INDEX "package_name_version_uq" ON "package" USING btree ("name","version");--> statement-breakpoint
CREATE INDEX "package_group_idx" ON "package" USING btree ("alternative_group");--> statement-breakpoint
CREATE UNIQUE INDEX "prediction_uq" ON "prediction" USING btree ("analysis_id","candidate_idx","metric","model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_uq" ON "run" USING btree ("session_id","pair_index","arm");--> statement-breakpoint
CREATE INDEX "run_session_idx" ON "run" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_cell_key_uq" ON "session" USING btree ("cell_key","machine_id");--> statement-breakpoint
CREATE INDEX "session_host_profile_idx" ON "session" USING btree ("host_app_id","profile_id");--> statement-breakpoint
CREATE INDEX "session_kind_idx" ON "session" USING btree ("kind");