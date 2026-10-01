# DepLens — common tasks. Targets marked (TODO) are wired in later phases (docs/09).
.PHONY: install fixtures test typecheck hosts determinism calibrate machine aa noise clean migrate phase0 up dataset train eval paper-tables

install:
	pnpm install

fixtures:
	node research/fixtures/generate.mjs

test:
	pnpm -r test

typecheck:
	pnpm -r typecheck

# --- host apps (docs/07 §5, §8.4) ---
hosts:
	pnpm harness hosts

determinism:   ## every host built 3x in separate processes; dist hashes must match
	pnpm harness hosts --determinism

# --- measurement machine (docs/07 §3.2, FR-33) ---
calibrate:     ## measure and store this machine's calibration curve (median of 3 sweeps)
	pnpm harness calibrate --cpu 1,2,3,4,6 --repeats 3

machine:
	pnpm harness machine

aa:            ## A/A noise session at the default profile
	pnpm harness aa --host research/hosts/vanilla --profile mid-tier-mobile --pairs 10 --seed 11

noise:         ## A/A noise floor (MDE95) from stored sessions
	pnpm harness noise

clean:         ## prune node_modules from cached builds (run between campaign batches)
	pnpm harness clean

# --- database (docs/06 §6) ---
migrate:       ## apply the committed Drizzle migrations to $$DATABASE_URL
	cd packages/db && npx drizzle-kit migrate

# Harness validation (docs/07 §8). Run on the dedicated measurement machine, nothing else running.
phase0: fixtures
	cd packages/harness && npx tsx ../../research/experiments/phase0.ts

up:        ## (TODO P5) docker compose -f infra/docker-compose.yml up
	@echo "Phase 5: docker compose stack not created yet"

dataset:   ## (TODO P4) export Postgres → Parquet + data dictionary + hash
	@echo "Phase 4"

train:     ## (TODO P6) cd ml && uv run python -m deplens_ml.train
	@echo "Phase 6"

eval:      ## (TODO P6)
	@echo "Phase 6"

paper-tables: ## (TODO P8) regenerate every table/figure in the paper from the frozen dataset
	@echo "Phase 8"
