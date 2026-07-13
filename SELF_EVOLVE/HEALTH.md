# Product Health

## Baseline

- Last green cycle: 126 (all mandated gates passed on 2026-07-13)
- Known failing gates: none.
- Flaky tests: none observed
- Cycles 7-18 observation: Focused pure-function test coverage added for all 11 shared modules (diff, deroReferences, thinkingCapabilities, gnomon, agents, dvm, modelMetadata, presets, types normalizers, defaults, media). No new health debt observed.

## Debt queue

| ID | Observation | Risk | Evidence | Suggested action | Status |
|---:|---|---|---|---|---|
| H001 | Restore the TypeScript and ESLint baseline. | medium | Cycle 0: typecheck had 14 errors and lint had 2 unused-variable violations. Cycle 1: build, typecheck, lint, and 4 CLI test scripts pass. | Continue adding focused renderer-state coverage as features evolve. | resolved |
| H002 | Vision artifact modal lacked keyboard dismissal and programmatic dialog context. | low | Local Cycle 2 accessibility review of `VisionTab.tsx`. | Resolved with Escape handling, labelled dialog semantics, and a focused guard test. | resolved |
| H003 | Vision artifact extraction had no focused regression coverage for its streaming and format guards. | low | Local Cycle 5 review of `src/renderer/src/lib/artifacts.ts`. | Resolved with 17 dependency-free assertions in `artifacts.test.ts`, run by `test:vision`. | resolved |
| H004 | Shared utility modules had no test coverage. | low | Cycles 7-15 reviewed all 9 files in `src/shared/` with exported functions. | Resolved with 9 focused test suites totalling ~140 assertions, run by `test:shared`. | resolved |
