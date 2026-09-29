# DepLens — common tasks. Targets marked (TODO) are wired in later phases (docs/09).
.PHONY: install fixtures test typecheck aa phase0 up dataset train eval paper-tables

install:
	pnpm install

fixtures:
	node research/fixtures/generate.mjs

test:
	pnpm --filter @deplens/harness test

typecheck:
	pnpm --filter @deplens/harness typecheck

aa:
	pnpm harness aa --cpu 4 --pairs 10

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
