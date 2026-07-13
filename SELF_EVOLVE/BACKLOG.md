# Backlog

| ID | Feature | Status | Score (V/F/E/R) | Notes |
|---:|---|---|---|---|
| 001 | Restore the green baseline by resolving the recorded typecheck and lint failures | verified | 9 (5/5/3/1) | Cycle 1 restored build, typecheck, lint, and CLI test gates; driver integration pending. |
| 002 | Make the Vision artifact viewer keyboard-dismissible and expose dialog semantics | verified | 16 (4/4/1/1) | Cycle 2 added Escape dismissal, modal semantics, and an accessible close label; managed-driver integration pending. |
| 003 | Add focused pure-function coverage for Vision artifact rendering and state helpers | verified | 16 (4/5/2/1) | Cycle 3 added 14 renderer/helper assertions, alongside 3 existing viewer-key assertions; managed-driver integration pending. |
| 004 | Persist Vision gallery filter choices between visits | verified | 9 (3/4/2/2) | Cycle 4 stores query, type, and chat-scope filters in the renderer store; managed-driver integration pending. |
| 005 | Add focused regression coverage for Vision artifact extraction | verified | 19 (4/5/1/1) | Cycle 5 added 17 deterministic extractor assertions and included them in `test:vision`; managed-driver integration pending. |
| 006 | Add focused filtering coverage for the Vision gallery | idea | 13 (3/4/2/1) | Local discovery: grouping and filter predicates remain inline in `VisionTab.tsx`; consider extracting only if a future behavior change needs isolated tests. |
| 007 | Document the focused Vision test command in the verification guide | idea | 10 (2/3/1/1) | README currently lists CLI tests but not the existing `npm run test:vision` coverage. |
