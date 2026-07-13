# Product Health

## Baseline

- Last green cycle: 5 (managed driver integration pending)
- Known failing gates: none.
- Flaky tests: none observed
- Cycle 5 observation: Vision artifact extraction now has focused coverage for supported formats and streaming-safety guards; no new health debt observed.

## Debt queue

| ID | Observation | Risk | Evidence | Suggested action | Status |
|---:|---|---|---|---|---|
| H001 | Restore the TypeScript and ESLint baseline. | medium | Cycle 0: typecheck had 14 errors and lint had 2 unused-variable violations. Cycle 1: build, typecheck, lint, and 4 CLI test scripts pass. | Continue adding focused renderer-state coverage as features evolve. | resolved |
| H002 | Vision artifact modal lacked keyboard dismissal and programmatic dialog context. | low | Local Cycle 2 accessibility review of `VisionTab.tsx`. | Resolved with Escape handling, labelled dialog semantics, and a focused guard test. | resolved |
| H003 | Vision artifact extraction had no focused regression coverage for its streaming and format guards. | low | Local Cycle 5 review of `src/renderer/src/lib/artifacts.ts`. | Resolved with 17 dependency-free assertions in `artifacts.test.ts`, run by `test:vision`. | resolved |
