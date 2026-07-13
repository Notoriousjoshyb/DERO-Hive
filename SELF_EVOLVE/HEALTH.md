# Product Health

## Baseline

- Last green cycle: none
- Known failing gates: `npm run typecheck` exits 2 (two missing `AppState` members in `VisionTab.tsx`; one over-arity `sendMessage` call in `useChat.ts`); standalone `npm run typecheck:cli` exits 2 (11 errors: implicit-any parameters and Commander return-type incompatibilities); `npm run lint && npm run lint:cli` exits 1 (unused `ctx` in `src/main/tools/builtin.ts`, unused `MediaKind` in `MediaStudio.tsx`).
- Flaky tests: none observed

## Debt queue

| ID | Observation | Risk | Evidence | Suggested action | Status |
|---:|---|---|---|---|---|
| H001 | Restore the TypeScript and ESLint baseline. | medium | Cycle 0: build and 4 CLI test scripts pass; typecheck has 14 total errors and lint has 2 unused-variable violations. | Resolve the web and CLI type errors plus the two unused-variable lint violations, then rerun all configured gates. | open |
