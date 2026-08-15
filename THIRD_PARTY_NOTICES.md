# Third-Party Notices

DERO Hive includes and builds on third-party work. This file records the parts
where the licence asks for attribution, and the parts where Hive's own code was
written by following someone else's design closely enough that saying so is the
honest thing to do.

It is maintained by hand. Anything ported rather than reimplemented belongs
here, with its copyright notice retained in the source file as well.

---

## Designs adapted into Hive's own source

These files are Hive's code. They were written against another project's
documented design, and in some places its exact security properties, so the
source is credited both here and in the file header.

### DeepSeek Harness (`dsh`) — MIT, Copyright (c) 2026 DeepSeek

<https://github.com/deepseek-ai/deepseek-harness>

| Hive file | What was taken |
|---|---|
| `src/main/tools/spill.ts` | Tool-output spill policy, and its security properties: private `0700` root, unguessable filename prefix, exclusive `wx` create so a planted symlink cannot redirect the write, best-effort failure that keeps the inline result. |
| `src/main/tools/userQuestions.ts` | The user-questions seam: a provider-neutral question shape whose answer contract does not change with how a UI renders it. |
| `src/main/tools/jobs.ts` | The kind-agnostic background-job registry, and the rule that `run_in_background` is removed from the schema when the capability is off rather than advertised and refused. |
| `src/main/tools/catalog.ts` | Generating the tool catalog by *booting* the tools and reading their real schemas, rather than parsing source. |
| `src/main/tools/ripgrep.ts` | Packaging ripgrep for `glob`/`grep` behind a JS fallback. |

MIT permits reuse with the copyright and permission notice retained:

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Unsloth Studio / Desktop

<https://unsloth.ai>

| Hive file | What was taken |
|---|---|
| `scripts/lib/assets.mjs` | The pinned-asset manifest *pattern*: record kind, version, asset name, URL, sha256 and install time for every downloaded runtime, keeping pins (`pinned_sha256`) separate from observed hashes. |

**No Unsloth code is included, and none may be.** Licence checked 2026-08-15:
Unsloth dual-licenses, and the split matters here. The core `unsloth` training
library is **Apache-2.0**, but the **Studio / Desktop UI is AGPL-3.0** — the part
whose on-disk layout inspired `scripts/lib/assets.mjs`.

AGPL-3.0 is copyleft and incompatible with Hive's MIT licence, so **no code may
be copied from Unsloth Studio or Desktop into this repository**. What was taken
is a manifest *layout* — an idea, not an expression — which carries no licence
obligation. Anyone extending `scripts/lib/assets.mjs` must keep it that way and
write the code themselves rather than porting theirs.

Bundling binaries built from `unslothai/llama.cpp` is a separate question again:
those terms, plus llama.cpp's own MIT licence and its third-party notices, must
be reviewed and added here before any such build ships.

---

## Bundled binaries and models

Downloaded at install time by `scripts/setup-*.mjs`, not committed to this
repository. Each install writes a manifest recording exactly what landed.

| Component | Licence | Notes |
|---|---|---|
| ripgrep (via `@vscode/ripgrep`) | MIT / Unlicense | Backs `glob_files` and `grep_files`. |
| whisper.cpp | MIT | Local speech-to-text. |
| Whisper models (ggml) | MIT (OpenAI weights, MIT) | Downloaded from the ggml model host. |
| DERO simulator (`derohe`) | Research licence — see the derohe repository | Built from a source tarball at install time. |

---

## npm dependencies

Runtime dependencies are declared in `package.json` and their licences ship
inside `node_modules`. The notable ones: Electron (MIT), React (MIT),
`better-sqlite3` (MIT), `@modelcontextprotocol/sdk` (MIT), `shiki` (MIT),
`mermaid` (MIT), `katex` (MIT), `pyodide` (MPL-2.0), `zustand` (MIT),
`zod` (MIT).

Pyodide is MPL-2.0: it is used unmodified, so the obligation is to keep its
notice and to publish any modifications should Hive ever make them.

---

## Corrections

If something is credited wrongly, or is missing, that is a bug in this file —
please open an issue.
