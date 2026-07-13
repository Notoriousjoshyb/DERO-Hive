# Backlog

| ID | Feature | Status | Score (V/F/E/R) | Notes |
|---:|---|---|---|---|
| 001 | Restore the green baseline by resolving the recorded typecheck and lint failures | verified | 9 (5/5/3/1) | Cycle 1 restored build, typecheck, lint, and CLI test gates; driver integration pending. |
| 002 | Make the Vision artifact viewer keyboard-dismissible and expose dialog semantics | verified | 16 (4/4/1/1) | Cycle 2 added Escape dismissal, modal semantics, and an accessible close label; managed-driver integration pending. |
| 003 | Add focused pure-function coverage for Vision artifact rendering and state helpers | verified | 16 (4/5/2/1) | Cycle 3 added 14 renderer/helper assertions, alongside 3 existing viewer-key assertions; managed-driver integration pending. |
| 004 | Persist Vision gallery filter choices between visits | verified | 9 (3/4/2/2) | Cycle 4 stores query, type, and chat-scope filters in the renderer store; managed-driver integration pending. |
| 005 | Add focused regression coverage for Vision artifact extraction | verified | 19 (4/5/1/1) | Cycle 5 added 17 deterministic extractor assertions and included them in `test:vision`; managed-driver integration pending. |
| 006 | Harden preload IPC callback parameter types | verified | 10 (2/4/2/2) | Cycle 6 replaced 7 `any` IPC listener types with proper shared types in `src/preload/index.ts`; managed-driver integration pending. |
| 007 | Add focused diff.ts test coverage | verified | 16 (4/5/1/1) | Cycle 7 added 19+ assertions for LCS diff, cap fallback, and context collapse. |
| 008 | Add focused deroReferences.ts test coverage | verified | 14 (3/5/1/1) | Cycle 8 added 20+ assertions for DERO reference extraction and formatting. |
| 009 | Add focused thinkingCapabilities.ts test coverage | verified | 16 (4/5/1/1) | Cycle 9 added 20+ assertions for reasoning-effort provider logic. |
| 010 | Add focused gnomon.ts test coverage | verified | 13 (3/5/1/1) | Cycle 10 added 12+ assertions for index query and discovery formatting. |
| 011 | Add focused agents.ts test coverage | verified | 16 (4/5/1/1) | Cycle 11 added 15+ assertions for agent resolution and dispatch logic. |
| 012 | Add focused dvm.ts test coverage | verified | 18 (5/5/1/1) | Cycle 12 added 15+ assertions for DVM-BASIC linting engine. |
| 013 | Add focused modelMetadata.ts test coverage | verified | 14 (3/5/1/1) | Cycle 13 added 18+ assertions for model lookup and media classification. |
| 014 | Add focused presets.ts test coverage | verified | 11 (2/4/1/1) | Cycle 14 added 8+ assertions for provider preset lookup and uniqueness. |
| 015 | Add focused types.ts normalizer test coverage | verified | 11 (3/4/1/1) | Cycle 15 added 20+ assertions for path/config/approval-mode validators. |
| 016 | Document all test commands in README | verified | 10 (2/3/1/1) | Cycle 16 updated Verification section and added `test:all` script. |
| 017 | ESLint config improvements | verified | 8 (1/3/1/1) | Cycle 17 added `cli/dist/` ignore and shared test file coverage. |
| 018 | Add focused defaults.ts and media.ts test coverage | verified | 14 (3/4/1/1) | Cycle 18 added defaults.test.ts (7 skills) and media.test.ts (9 presets) with 2 new suites to `test:shared`. |
| 019 | Add focused thinking.ts test coverage | verified | 16 (4/5/1/1) | Cycle 19 added thinking.test.ts with 15 assertions for regex-based <think>/think/thought block extraction; fixed 4 type errors in pre-existing tokenManager.test.ts. |
| 020 | Add focused visionRender.ts test coverage | verified | 12 (3/4/1/1) | Cycle 21 added visionRender.test.ts (8 render branches) and registered it in test:vision.
| 021 | Add focused codeRunner.ts and customSlashCommands.ts test coverage | verified | 11 (3/4/1/1) | Cycle 21 added codeRunner.test.ts (isRunnableLanguage, normalizeLanguage) and customSlashCommands.test.ts (parseCommandMetadata); new test:renderer script.
| 023 | HEALTH — gates green, no changes | verified | 8 (1/3/1/1) | Cycle 22 confirmed all gates green. |
| 024 | Add focused audioWav.ts test coverage | verified | 11 (3/4/1/1) | Cycle 23 added audioWav.test.ts (WAV header, resampling, clamping, byteRate); added to test:renderer. |
| 025 | Add focused speech.ts test coverage | verified | 11 (3/4/1/1) | Cycle 23 added speech.test.ts (getVoices, speak, stop, isSpeaking); added to test:renderer. |
| 026 | Add focused theme.ts test coverage | verified | 11 (3/4/1/1) | Cycle 24 added theme.test.ts (hexToRgb, rgbToHex, getContrastColor, generateColorPalette, adjustBrightness); added to test:renderer. |
| 027 | HEALTH — gates green, no changes | verified | 8 (1/3/1/1) | Cycle 25 confirmed all gates green. |
| 028 | Add focused CLI format.ts table() test coverage | verified | 11 (3/4/1/1) | Cycle 26 added format.test.ts (table content/layout/multiline/empty/wide cols); added to test:cli. |
| 029 | Add focused CLI themes.ts listThemes() test coverage | verified | 11 (3/4/1/1) | Cycle 27 added themes.test.ts (count, fields, IDs, no dupes, descriptions); added to test:cli. |
| 030 | project.ts test skipped (DB dependency) | verified | 8 (1/3/1/1) | Cycle 28 attempted project.test.ts — createProject requires Electron getDb(), not mockable in pure env; skipped. |
| 031 | HEALTH — gates green, no changes | verified | 8 (1/3/1/1) | Cycle 29 confirmed all gates green; test coverage targets exhausted. |
| 032 | HEALTH — gates green, no changes | verified | 8 (1/3/1/1) | Cycle 30 confirmed all gates green.
| 033 | fixed getSetting as-unknown-as-T bug in settings.ts + provider.ts | verified | 8 (1/3/1/1) | Cycle 31: JsonResult<T> discriminated union eliminates silent type corruption on parse failure. |
| 034 | HEALTH — gates green, no changes | verified | 8 (1/3/1/1) | Cycle 32 confirmed all gates green. |
| 035 | Fixed getSetting as-unknown-as-T bug in src/main/db/client.ts | verified | 9 (3/5/1/1) | Cycle 35: JsonResult<T> discriminated union eliminates silent type corruption on parse failure. |
| 036 | Removed redundant `as unknown as GhMatch` cast in ComposerAutocomplete | verified | 8 (1/3/1/1) | Cycle 36: cast redundant after 'error' guard narrows type to GhMatch. |
| 037 | Added tokenBudget.ts test coverage (14 assertions) | verified | 8 (1/3/1/1) | Cycle 37: all pure functions in tokenBudget.ts now tested. |
| 038 | Added attachments.ts pure-function test coverage (7 assertions) | verified | 8 (1/3/1/1) | Cycle 38: attachmentIds and serializedAttachmentIds tested. |
| 039 | chat.ts silent JSON.parse catch blocks → logger.warn | verified | 8 (1/3/1/1) | Cycle 39: 3 silent catch blocks in rowToMessage now log warnings. |
| 040 | HEALTH — gates green | verified | 8 (1/3/1/1) | Cycle 40: health cadence. |
| 041 | conversations.ts silent JSON.parse catch blocks → logger.warn | verified | 8 (1/3/1/1) | Cycle 41: 2 silent catch blocks now log warnings. |
| 042 | FEATURE DISCOVERY — web search competitors/adjacent tools, synthesised 5 feature candidates | discovery | 8 (1/3/1/1) | Cycle 42: candidates: (1) NL DB query, (2) AI agent file tree, (3) project-wide refactor, (4) inline code explanation, (5) diff narrator. |
| 043-084 | in progress | pending | — | Remaining cycles 43-84. |
| 131 | Add focused systemPrompt.ts test coverage | verified | 9 (2/5/1/1) | Cycle 131: 11 assertions covering TERMINAL_SYSTEM_PROMPT inheritance, section presence, and Vision paragraph stripping. |
| 131+ | in progress (Agent 2) | pending | — | Remaining cycles 132-170. |

## Feature Candidates (from Cycle 42 Discover)

| ID | Feature | V | F | E | R | Score | Status |
|---|---|---|---|---|---|---|---|
| F1 | Natural language DB query — type a question, get SQLite answer | 3 | 5 | 1 | 2 | 11 | candidate |
| F2 | AI agent file tree — Cursor-style: "find the file that handles X" | 4 | 5 | 2 | 2 | 13 | candidate |
| F3 | Project-wide refactor — rename symbol across all files | 2 | 4 | 1 | 1 | 8 | candidate |
| F4 | Inline code explanation — hover any function, plain-English | 3 | 4 | 1 | 2 | 10 | candidate |
| F5 | Diff narrator — after self-evolve cycle, narrate changes in plain English | 3 | 4 | 1 | 1 | 9 | candidate |

## Agent 1 outcomes - Cycles 91-130

| Cycle | Improvement | Status | Score |
|---:|---|---|---|
| 91 | Slash-command empty-input regression coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 92 | Slash-command case-normalisation coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 93 | Double-quoted slash-command argument coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 94 | Escaped quoted-argument coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 95 | HEALTH - full gate cadence | verified - health gates only | V1/F5/E5/R1 |
| 96 | Unterminated quoted-argument resilience coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 97 | Unknown slash-command preservation coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 98 | Slash-command argument-text fidelity coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 99 | Preserve explicitly empty quoted arguments | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 100 | HEALTH - full gate cadence | verified - health gates only | V1/F5/E5/R1 |
| 101 | Exact command-name ranking coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 102 | Command alias ranking coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 103 | Command keyword discovery coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 104 | Command description discovery coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 105 | HEALTH - full gate cadence | verified - health gates only | V1/F5/E5/R1 |
| 106 | Dynamic skill-command normalisation coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 107 | Disabled skill-command exclusion coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 108 | Malformed skill-command exclusion coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 109 | Duplicate skill-command de-duplication coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 110 | HEALTH - full gate cadence | verified - health gates only | V1/F5/E5/R1 |
| 111 | Built-in command collision protection coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 112 | Skill-command fallback metadata coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 113 | Structured command-suggestion projection coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 114 | Zero suggestion-limit boundary coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 115 | HEALTH - full gate cadence | verified - health gates only | V1/F5/E5/R1 |
| 116 | Negative suggestion-limit boundary coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 117 | Fractional suggestion-limit normalisation coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 118 | Non-finite suggestion-limit fallback coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 119 | Built-in command catalog integrity coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 120 | HEALTH - full gate cadence | verified - health gates only | V1/F5/E5/R1 |
| 121 | Terminal theme alias resolution coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 122 | Environment-selected terminal theme coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 123 | Terminal colour-scheme hint coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 124 | COLORFGBG terminal detection coverage | verified - focused regression/source improvement | V3/F5/E1/R1 |
| 125 | HEALTH - full gate cadence | verified - health gates only | V1/F5/E5/R1 |
