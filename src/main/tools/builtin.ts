import type { ToolDefinition, MediaKind, MediaGenerationRequest, UserQuestion } from '@shared/types';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fg from 'fast-glob';
import { resolveAndValidate } from '../utils/pathPolicy';
import type { ToolExecutor, ToolContext, ToolResult } from './registry';
import { getMediaManager } from '../media/instance';
import { getSimulatorManager } from '../simulator/instance';
import { userQuestions, formatAnswers } from './userQuestions';
import { rgFiles, rgSearch } from './ripgrep';
import { jobs, startShellJob } from './jobs';
import { applyEdits, parseEditArgs } from './edits';
import { runGit, isRepo, parseStatus, parseLog, formatStatus, assertSafeArg, LOG_FORMAT } from './git';
import { fetchUrl } from './webFetch';
import { webSearch, webSearchAvailable, formatResults } from './webSearch';
import { runLsp, type LspAction } from './lsp';
import { getSetting } from '../db/client';
import { lintDvmBasic } from '@shared/dvm';
import type { IndexQuery } from '@shared/gnomon';
import { diffLines, diffCounts } from '@shared/diff';
import { captureCheckpoint } from '../checkpoints/store';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

function safeResolve(p: string, cwd: string): string {
  return resolveAndValidate(p, cwd);
}

// Capture a bounded before/after snapshot of a file edit so the renderer can
// render a terminal-style diff. We cap each side at ~50KB so very large files
// don't bloat the IPC payload — anything over the cap is truncated with a
// marker the UI can show. The numbers are intentionally generous because the
// diff is the most useful signal in the activity log.
const DIFF_SNAPSHOT_MAX_BYTES = 50_000;

function snapshotForDiff(content: string): { text: string; truncated: boolean } {
  if (content.length <= DIFF_SNAPSHOT_MAX_BYTES) return { text: content, truncated: false };
  return {
    text: content.slice(0, DIFF_SNAPSHOT_MAX_BYTES),
    truncated: true
  };
}

// Persist a full-content checkpoint for an edit so it can be reverted later.
// Unlike the display snapshot above this is NOT capped — the whole before/after
// bytes go to the blob store. Best-effort: a capture failure must never fail or
// block the file write itself, so we log and return undefined.
function captureEditCheckpoint(ctx: ToolContext, abs: string, before: Buffer | null, after: Buffer): string | undefined {
  try {
    return captureCheckpoint({
      conversationId: ctx.conversationId,
      toolCallId: ctx.toolCallId,
      path: abs,
      before,
      after
    });
  } catch (err) {
    logger.warn('checkpoints', `failed to capture checkpoint for ${abs}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

const READ_FILE_DEF: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file. Returns text, or base64 for binary files. Supports line ranges.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or working-directory-relative path' },
      start_line: { type: 'integer', description: '1-based start line (optional)' },
      end_line: { type: 'integer', description: '1-based end line (optional, inclusive)' },
      encoding: { type: 'string', enum: ['utf-8', 'base64'], description: 'Default utf-8; use base64 for binaries' }
    },
    required: ['path']
  }
};

const WRITE_FILE_DEF: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file, creating parent directories as needed. Overwrites existing files.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' }
    },
    required: ['path', 'content']
  }
};

const EDIT_FILE_DEF: ToolDefinition = {
  name: 'edit_file',
  description:
    'Replace exact text in a file. Pass "edits" to apply several replacements to the same file in one atomic call — either all of them apply or the file is left untouched. Each old_text must match uniquely unless replace_all is set.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      edits: {
        type: 'array',
        description: 'Ordered replacements. Each one sees the result of the previous. Preferred over old_text/new_text.',
        items: {
          type: 'object',
          properties: {
            old_text: { type: 'string', description: 'Exact text to replace, with enough context to be unique.' },
            new_text: { type: 'string' },
            replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring a unique match.' }
          },
          required: ['old_text', 'new_text']
        }
      },
      old_text: { type: 'string', description: 'Single-edit form. Exact text to replace.' },
      new_text: { type: 'string', description: 'Single-edit form. Replacement text.' },
      replace_all: { type: 'boolean', description: 'Single-edit form. Replace every occurrence.' }
    },
    required: ['path']
  }
};

const LIST_DIR_DEF: ToolDefinition = {
  name: 'list_directory',
  description: 'List files and subdirectories in a directory.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path']
  }
};

const GLOB_DEF: ToolDefinition = {
  name: 'glob_files',
  description: 'Find files matching a glob pattern. Example: "src/**/*.ts".',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      cwd: { type: 'string' },
      ignore: { type: 'array', items: { type: 'string' }, description: 'Glob patterns to skip. Defaults skip node_modules, .git and dist.' }
    },
    required: ['pattern']
  }
};

const GREP_DEF: ToolDefinition = {
  name: 'grep_files',
  description: 'Search for a regex pattern across files. Returns file:line:content matches. Skips binary files and anything gitignored.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      cwd: { type: 'string' },
      include: { type: 'string', description: 'Glob filter, e.g. "*.ts"' },
      ignore: { type: 'array', items: { type: 'string' }, description: 'Glob patterns to skip.' },
      max_results: { type: 'integer', default: 100, description: 'Stop after this many matching lines.' }
    },
    required: ['pattern']
  }
};

const ASK_USER_DEF: ToolDefinition = {
  name: 'ask_user_question',
  description:
    'Ask the user a question when you need a decision, a choice, or information only they have, and proceeding on a guess would produce materially different work. Blocks until they answer. Prefer making routine judgement calls yourself.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'One or more questions to ask before continuing.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable id for this question; echoed in the answer.' },
            question: { type: 'string', description: 'The specific question to ask.' },
            header: { type: 'string', description: 'Optional short heading, e.g. "Confirm" or "Choose mode".' },
            options: {
              type: 'array',
              description: 'Optional choices. If you recommend one, put it first and append "(Recommended)" to its label.',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Short option label. This exact text comes back as the answer.' },
                  description: { type: 'string', description: 'One sentence on the tradeoff or impact.' }
                },
                required: ['label']
              }
            },
            multi_select: { type: 'boolean', description: 'Whether more than one option may be chosen. Defaults to false.' }
          },
          required: ['id', 'question']
        }
      }
    },
    required: ['questions']
  }
};

const SHELL_DEF: ToolDefinition = {
  name: 'run_shell',
  description: 'Execute a shell command. Output is captured stdout+stderr. Use with care.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      cwd: { type: 'string' },
      timeout_ms: { type: 'integer', default: 30_000, description: 'Kill the command after this long. Ignored for background jobs.' }
    },
    required: ['command']
  }
};

/**
 * The background half of run_shell, and the three tools that manage whatever is
 * running. These are advertised only when background jobs are enabled — a
 * parameter that is present but always refused is worse than one that is
 * absent, because the model spends a turn discovering the refusal.
 */
const SHELL_BACKGROUND_PARAM = {
  run_in_background: {
    type: 'boolean',
    description: 'Start the command and return immediately with a job id instead of waiting. Use for servers, watchers and long builds, then read it with job_output.'
  }
} as const;

const JOB_LIST_DEF: ToolDefinition = {
  name: 'job_list',
  description: 'List background jobs for this conversation: id, what is running, status and exit code.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      all: { type: 'boolean', description: 'Include jobs started by other conversations. Defaults to false.' }
    }
  }
};

const JOB_OUTPUT_DEF: ToolDefinition = {
  name: 'job_output',
  description: 'Read output from a background job. Pass the cursor returned by the previous call to read only what is new.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      job_id: { type: 'string' },
      cursor: { type: 'integer', description: 'Character offset to resume from. Omit to read from the start.' },
      max_chars: { type: 'integer', description: 'Most characters to return in this call. Default 20000.' }
    },
    required: ['job_id']
  }
};

const JOB_KILL_DEF: ToolDefinition = {
  name: 'job_kill',
  description: 'Stop a running background job and its child processes.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: { job_id: { type: 'string' } },
    required: ['job_id']
  }
};

const GIT_STATUS_DEF: ToolDefinition = {
  name: 'git_status',
  description: 'Show the working tree status: branch, tracking, staged, unstaged and untracked files. Read-only.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: { cwd: { type: 'string', description: 'Repository path. Defaults to the working directory.' } }
  }
};

const GIT_DIFF_DEF: ToolDefinition = {
  name: 'git_diff',
  description: 'Show a unified diff of the working tree. Read-only.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string' },
      path: { type: 'string', description: 'Limit the diff to one file or directory.' },
      staged: { type: 'boolean', description: 'Diff the index against HEAD instead of the working tree.' },
      base: { type: 'string', description: 'Diff against this ref (branch, tag or commit) instead of HEAD.' },
      stat: { type: 'boolean', description: 'Return a per-file summary instead of the full diff.' }
    }
  }
};

const GIT_LOG_DEF: ToolDefinition = {
  name: 'git_log',
  description: 'List recent commits: hash, author, date and subject. Read-only.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string' },
      max_count: { type: 'integer', description: 'How many commits to return. Default 20, max 200.' },
      path: { type: 'string', description: 'Only commits touching this path.' },
      author: { type: 'string', description: 'Only commits by this author (substring match).' }
    }
  }
};

const GIT_BRANCH_DEF: ToolDefinition = {
  name: 'git_branch',
  description: 'List branches, or create and switch to one. Listing is read-only; create and switch change the checkout.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string' },
      create: { type: 'string', description: 'Create this branch from the current HEAD and switch to it.' },
      switch_to: { type: 'string', description: 'Switch to an existing branch.' },
      remote: { type: 'boolean', description: 'Include remote-tracking branches when listing.' }
    }
  }
};

const GIT_COMMIT_DEF: ToolDefinition = {
  name: 'git_commit',
  description: 'Commit staged changes. Set all to stage tracked modifications first. Never bypasses hooks.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string' },
      message: { type: 'string', description: 'Commit message. The first line is the subject.' },
      all: { type: 'boolean', description: 'Stage every tracked modified file first (git commit -a). Does not add untracked files.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Stage exactly these paths before committing.' }
    },
    required: ['message']
  }
};

const GIT_PUSH_DEF: ToolDefinition = {
  name: 'git_push',
  description: 'Push commits to a remote. Always asks the user first, in every approval mode.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string' },
      remote: { type: 'string', description: 'Remote name. Default origin.' },
      branch: { type: 'string', description: 'Branch to push. Defaults to the current branch.' },
      set_upstream: { type: 'boolean', description: 'Set the pushed branch as upstream (-u).' }
    }
  }
};

const LSP_DEF: ToolDefinition = {
  name: 'lsp',
  description:
    'Ask a language server about code: where a symbol is defined, what references it, what its type is, what is wrong with a file, or what it contains. Far more accurate than grep for these questions. Lines and columns are 1-based, as shown in editors and compiler errors. Returns LSP_UNAVAILABLE if no server is configured for this file type — fall back to grep_files then.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['definition', 'references', 'hover', 'diagnostics', 'symbols'],
        description: 'definition/references/hover need line and character; diagnostics and symbols work on the whole file.'
      },
      path: { type: 'string', description: 'File to ask about.' },
      line: { type: 'integer', description: '1-based line of the symbol.' },
      character: { type: 'integer', description: '1-based column of the symbol.' }
    },
    required: ['action', 'path']
  }
};

const WEB_SEARCH_DEF: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web and return ranked results with titles, URLs and snippets. Follow a result with web_fetch to read the page.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for. Plain words work better than operators.' },
      count: { type: 'integer', description: 'How many results to return. Default 5, max 20.' }
    },
    required: ['query']
  }
};

const WEB_FETCH_DEF: ToolDefinition = {
  name: 'web_fetch',
  description: 'Fetch a public http/https URL and return its text as markdown. Follows up to 5 redirects, caps the body at 2 MB, and refuses private, loopback and non-text targets.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Absolute http or https URL.' } },
    required: ['url']
  }
};

const TODO_DEF: ToolDefinition = {
  name: 'todo_write',
  description: 'Maintain a structured task list. Use for multi-step work to track progress.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The complete list, resent in full each time. Exactly one task should be in_progress.',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            active_form: { type: 'string' }
          },
          required: ['content', 'status']
        }
      }
    },
    required: ['todos']
  }
};

const DVM_LINT_DEF: ToolDefinition = {
  name: 'lint_dvm_basic',
  description: 'Run deterministic structural checks on DERO DVM-BASIC source. Read-only; this is not a compiler, so use a simulator or daemon gas estimate to confirm execution validity.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: { source: { type: 'string', description: 'Complete DVM-BASIC smart-contract source code' } },
    required: ['source']
  }
};

const SIMULATOR_INFO_DEF: ToolDefinition = {
  name: 'get_simulator_chain_info',
  description: 'Read the local DERO simulator chain state from its loopback-only RPC endpoint (127.0.0.1:20000). Read-only; returns an error if the simulator is not running.',
  source: 'builtin',
  parameters: { type: 'object', properties: {} }
};

const SIMULATOR_CREATE_WALLET_DEF: ToolDefinition = {
  name: 'simulator_create_wallet',
  description: 'Create a new fixture wallet on the DERO simulator and return its address.',
  source: 'builtin',
  parameters: { type: 'object', properties: {} }
};

const SIMULATOR_GET_BALANCE_DEF: ToolDefinition = {
  name: 'simulator_get_balance',
  description: 'Get the encrypted balance for an address on the simulator.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      address: { type: 'string', description: 'DERO address (dero1...) to check balance for.' },
      scid: { type: 'string', description: 'Optional SCID to check token balance; omit for native DERO.' }
    }
  }
};

const SIMULATOR_GET_CONTRACT_STATE_DEF: ToolDefinition = {
  name: 'simulator_get_contract_state',
  description: 'Read smart contract storage state from the simulator by SCID and optional keys.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      scid: { type: 'string', description: 'Smart Contract ID (64-char hex).' },
      keys: { type: 'string', description: 'Comma-separated storage key names to read; omit for all keys.' }
    }
  }
};

const SIMULATOR_GET_HEIGHT_DEF: ToolDefinition = {
  name: 'simulator_get_height',
  description: 'Get the current block height of the running simulator.',
  source: 'builtin',
  parameters: { type: 'object', properties: {} }
};

const GENERATE_IMAGE_DEF: ToolDefinition = {
  name: 'generate_image',
  description: 'Generate an image from a text prompt and save it for the user. Use this whenever the user asks you to create, draw, or make an image/picture/illustration.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'A detailed description of the image to generate.' },
      aspect: { type: 'string', enum: ['square', 'portrait', 'landscape'], description: 'Aspect ratio. Default square.' }
    },
    required: ['prompt']
  }
};

const GENERATE_AUDIO_DEF: ToolDefinition = {
  name: 'generate_audio',
  description: 'Generate spoken audio (text-to-speech) from text and save it for the user. Use when the user asks you to say something aloud, narrate, or produce a voiceover.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to speak.' },
      voice: { type: 'string', description: 'Optional voice name (e.g. alloy, nova) or ElevenLabs voice id.' }
    },
    required: ['text']
  }
};

const GENERATE_VIDEO_DEF: ToolDefinition = {
  name: 'generate_video',
  description: 'Generate a short video from a text prompt and save it for the user. Requires a dedicated video-capable media provider (e.g. Replicate or ComfyUI).',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'A description of the video to generate.' },
      duration_seconds: { type: 'integer', description: 'Clip length in seconds (default 5).' }
    },
    required: ['prompt']
  }
};

const GENERATE_DVM_CONTRACT_DEF: ToolDefinition = {
  name: 'generate_dvm_contract',
  description: 'Generate a complete DVM-BASIC smart contract from a plain-language specification. The model should provide a detailed brief describing actors, assets, state variables, access rules, functions, failure cases, and test scenarios. This tool validates the structure with the DVM linter.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Contract name (PascalCase, e.g. "Token", "Lottery", "Vault").' },
      brief: { type: 'string', description: 'Detailed contract specification: actors, state, access rules, functions, failure modes, and test cases.' }
    },
    required: ['name', 'brief']
  }
};

const AUDIT_DVM_CONTRACT_DEF: ToolDefinition = {
  name: 'audit_dvm_contract',
  description: 'Run a comprehensive DERO DVM-BASIC security audit against a fixed checklist. Reviews access control, fund safety, state integrity, reentrancy, overflow, initialization, denial-of-service, and privacy. Returns findings with severity, affected lines, exploit paths, and remediations.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Full DVM-BASIC contract source code to audit.' },
      contractName: { type: 'string', description: 'Optional contract name for context.' }
    },
    required: ['source']
  }
};

const GENERATE_TELA_DAPP_DEF: ToolDefinition = {
  name: 'generate_tela_dapp',
  description: 'Scaffold a complete TELA dApp project including DVM-BASIC contract, HTML/CSS/JS frontend, XSWD wallet connection, mock fixtures, and deployment manifest.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'dApp name (used as directory name and contract name).' },
      description: { type: 'string', description: 'Brief description of what the dApp does.' }
    },
    required: ['name', 'description']
  }
};

const DISCOVER_CONTRACTS_DEF: ToolDefinition = {
  name: 'discover_contracts',
  description: 'Discover DERO smart contracts indexed by Gnomon. Search by function name, similarity, transaction history, or TELA apps. Results include SCID, deployment height, functions, and related contracts.',
  source: 'builtin',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query: a function name, SCID, or keyword to find related contracts.' },
      kind: { type: 'string', description: 'Search kind: similar-contracts, by-function, by-transaction, or tela-apps. Default: similar-contracts.' }
    }
  }
};

export const BUILTIN_TOOLS: ToolDefinition[] = [
  READ_FILE_DEF, WRITE_FILE_DEF, EDIT_FILE_DEF,
  LIST_DIR_DEF, GLOB_DEF, GREP_DEF,
  SHELL_DEF, TODO_DEF, ASK_USER_DEF,
  JOB_LIST_DEF, JOB_OUTPUT_DEF, JOB_KILL_DEF,
  GIT_STATUS_DEF, GIT_DIFF_DEF, GIT_LOG_DEF, GIT_BRANCH_DEF, GIT_COMMIT_DEF, GIT_PUSH_DEF,
  LSP_DEF, WEB_SEARCH_DEF, WEB_FETCH_DEF,
  DVM_LINT_DEF, SIMULATOR_INFO_DEF,
  SIMULATOR_CREATE_WALLET_DEF, SIMULATOR_GET_BALANCE_DEF, SIMULATOR_GET_CONTRACT_STATE_DEF, SIMULATOR_GET_HEIGHT_DEF,
  GENERATE_IMAGE_DEF, GENERATE_AUDIO_DEF, GENERATE_VIDEO_DEF,
  GENERATE_DVM_CONTRACT_DEF,
  AUDIT_DVM_CONTRACT_DEF,
  GENERATE_TELA_DAPP_DEF,
  DISCOVER_CONTRACTS_DEF
];

/** Background jobs are on unless the user turned them off in settings. */
export function backgroundJobsEnabled(): boolean {
  try {
    return (getSetting<{ backgroundJobs?: unknown }>('appSettings') || {}).backgroundJobs !== false;
  } catch {
    // No database (tests, early boot) — the capability is not the place to fail.
    return true;
  }
}

/**
 * The tools as the model actually sees them right now. Capability-dependent
 * pieces are added here rather than advertised and refused later: with
 * background jobs off, `run_in_background` is not in the schema and the three
 * job tools are not in the list at all.
 */
export function listBuiltinTools(): ToolDefinition[] {
  const background = backgroundJobsEnabled();
  const search = webSearchAvailable();
  let tools = BUILTIN_TOOLS;
  if (!background) {
    tools = tools.filter((t) => t.name !== 'job_list' && t.name !== 'job_output' && t.name !== 'job_kill');
  }
  // No search provider configured means no search tool. The model must never
  // be shown a tool whose only possible answer is "ask your user for a key".
  if (!search) tools = tools.filter((t) => t.name !== 'web_search');
  if (!background) return tools;
  return tools.map((t) =>
    t.name === 'run_shell'
      ? { ...t, parameters: { ...t.parameters, properties: { ...(t.parameters.properties as object), ...SHELL_BACKGROUND_PARAM } } }
      : t
  );
}

export const builtinExecutors: Record<string, ToolExecutor> = {
  async read_file(args, ctx: ToolContext) {
    const { path, start_line, end_line, encoding } = args as { path: string; start_line?: number; end_line?: number; encoding?: 'utf-8' | 'base64' };
    const abs = safeResolve(path, ctx.cwd);
    if (!existsSync(abs)) return { content: `Error: file not found: ${abs}`, isError: true };

    const enc = encoding || 'utf-8';
    if (enc === 'base64') {
      const buf = await readFile(abs);
      return { content: buf.toString('base64') };
    }
    const text = await readFile(abs, 'utf-8');
    const lines = text.split('\n');
    if (start_line || end_line) {
      const start = (start_line || 1) - 1;
      const end = end_line || lines.length;
      return { content: lines.slice(start, end).join('\n'), meta: { totalLines: lines.length, range: [start + 1, end] } };
    }
    if (lines.length > 2000) {
      return { content: lines.slice(0, 2000).join('\n') + `\n\n... [truncated, ${lines.length} total lines. Use start_line/end_line to read more.]` };
    }
    return { content: text };
  },

  async write_file(args, ctx) {
    const { path, content } = args as { path: string; content: string };
    const abs = safeResolve(path, ctx.cwd);
    let prevBytes: Buffer | null = null;
    let prevText = '';
    let isNewFile = true;
    try {
      prevBytes = await readFile(abs);
      prevText = prevBytes.toString('utf-8');
      isNewFile = false;
    } catch { /* new file */ }
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, content, 'utf-8');
    const checkpointId = captureEditCheckpoint(ctx, abs, prevBytes, Buffer.from(content, 'utf-8'));
    const stats = diffCounts(diffLines(prevText, content));
    const beforeSnap = snapshotForDiff(prevText);
    const afterSnap = snapshotForDiff(content);
    return {
      content: `Wrote ${content.length} bytes to ${abs}`,
      meta: {
        path: abs,
        kind: 'write',
        isNewFile,
        checkpointId,
        bytesAdded: content.length - prevText.length,
        linesAdded: stats.added,
        linesRemoved: stats.removed,
        finalLines: content.split('\n').length,
        // Snapshot for the renderer's terminal-style diff view. Capped.
        before: beforeSnap.text,
        after: afterSnap.text,
        beforeTruncated: beforeSnap.truncated,
        afterTruncated: afterSnap.truncated
      }
    };
  },

  async edit_file(args, ctx) {
    const { path } = args as { path: string };
    const hunks = parseEditArgs(args);
    if (!hunks) return { content: 'Error: pass either "edits" (an array) or "old_text"/"new_text".', isError: true };

    const abs = safeResolve(path, ctx.cwd);
    const prevBytes = await readFile(abs);
    const text = prevBytes.toString('utf-8');

    // Atomic: applyEdits either returns the fully edited text or an error
    // naming the hunk that missed. Nothing is written on failure.
    const result = applyEdits(text, hunks);
    if (!result.ok) return { content: `Error editing ${abs}: ${result.error}`, isError: true };
    const updated = result.text;

    await writeFile(abs, updated, 'utf-8');
    const checkpointId = captureEditCheckpoint(ctx, abs, prevBytes, Buffer.from(updated, 'utf-8'));
    const stats = diffCounts(diffLines(text, updated));

    // One hunk keeps the tight hunk-level snapshot (3 lines of context each
    // side). Several hunks are scattered through the file, so the renderer gets
    // the whole before/after instead of a misleading single window.
    const single = hunks.length === 1 ? hunks[0] : null;
    const contextLines = 3;
    let hunkStartLine = 1;
    let beforeText = text;
    let afterText = updated;
    if (single) {
      const editLineNo = result.applied[0].line;
      const beforeLines = text.split('\n');
      const afterLines = updated.split('\n');
      beforeText = [
        ...beforeLines.slice(Math.max(0, editLineNo - 1 - contextLines), editLineNo - 1),
        ...single.oldText.split('\n')
      ].join('\n');
      afterText = [
        ...afterLines.slice(Math.max(0, editLineNo - 1 - contextLines), editLineNo - 1),
        ...single.newText.split('\n')
      ].join('\n');
      hunkStartLine = Math.max(1, editLineNo - contextLines);
    }
    const beforeSnap = snapshotForDiff(beforeText);
    const afterSnap = snapshotForDiff(afterText);

    const summary = hunks.length === 1
      ? `Edited ${abs}`
      : `Edited ${abs} — ${result.applied.length} edits applied at lines ${result.applied.map((a) => a.line).join(', ')}`;
    return {
      content: summary,
      meta: {
        path: abs,
        kind: 'edit',
        checkpointId,
        editCount: result.applied.length,
        bytesAdded: updated.length - text.length,
        linesAdded: stats.added,
        linesRemoved: stats.removed,
        // Hunk-relative start line (1-based) — the renderer adds/subtracts
        // context lines to compute absolute line numbers.
        hunkStartLine,
        before: beforeSnap.text,
        after: afterSnap.text,
        beforeTruncated: beforeSnap.truncated,
        afterTruncated: afterSnap.truncated
      }
    };
  },

  async list_directory(args, ctx) {
    const { path } = args as { path: string };
    const abs = safeResolve(path, ctx.cwd);
    const entries = await readdir(abs, { withFileTypes: true });
    const out = entries
      .filter((e) => !e.name.startsWith('.') || e.name === '.gitignore' || e.name === '.env.example')
      .map((e) => `${e.isDirectory() ? 'd' : 'f'}  ${e.name}`)
      .sort();
    return { content: out.join('\n') || '(empty)' };
  },

  async glob_files(args, ctx) {
    const { pattern, cwd, ignore } = args as { pattern: string; cwd?: string; ignore?: string[] };
    const base = cwd ? safeResolve(cwd, ctx.cwd) : ctx.cwd;

    const viaRg = await rgFiles(pattern, base, ignore).catch(() => null);
    const matches = viaRg ?? await fg(pattern, {
      cwd: base,
      ignore: ignore || ['**/node_modules/**', '**/.git/**', '**/dist/**'],
      dot: false
    });

    return { content: matches.slice(0, 500).join('\n') + (matches.length > 500 ? `\n... [${matches.length - 500} more]` : '') || '(no matches)' };
  },

  async grep_files(args, ctx) {
    const { pattern, cwd, include, ignore, max_results } = args as { pattern: string; cwd?: string; include?: string; ignore?: string[]; max_results?: number };
    const base = cwd ? safeResolve(cwd, ctx.cwd) : ctx.cwd;
    const limit = max_results || 100;

    // ripgrep skips binaries and honours .gitignore; the JS path below is the
    // fallback for platforms with no bundled binary.
    const viaRg = await rgSearch(pattern, base, include, ignore, limit).catch((err: unknown) => {
      // A bad regex is the model's problem to fix, not something to silently
      // retry with different semantics under the JS engine.
      const msg = err instanceof Error ? err.message : String(err);
      if (/regex|parse|syntax/i.test(msg)) throw err;
      return null;
    });
    if (viaRg) {
      const out = [...viaRg.lines];
      if (viaRg.truncated) out.push(`... [truncated at ${limit}]`);
      return { content: out.join('\n') || '(no matches)' };
    }

    const matches = await fg(include || '**/*', {
      cwd: base,
      ignore: ignore || ['**/node_modules/**', '**/.git/**', '**/dist/**'],
      absolute: false
    });
    const re = new RegExp(pattern, 'gm');
    const out: string[] = [];
    for (const file of matches) {
      const abs = join(base, file);
      let content: string;
      try { content = await readFile(abs, 'utf-8'); } catch { continue; }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (re.test(line)) {
          out.push(`${file}:${i + 1}:${line}`);
          if (out.length >= limit) break;
        }
        re.lastIndex = 0;
      }
      if (out.length >= limit) { out.push(`... [truncated at ${limit}]`); break; }
    }
    return { content: out.join('\n') || '(no matches)' };
  },

  async ask_user_question(args, ctx) {
    const raw = (args as { questions?: unknown }).questions;
    if (!Array.isArray(raw) || raw.length === 0) {
      return { content: 'ask_user_question requires a non-empty "questions" array.', isError: true };
    }
    // Normalize before it reaches the UI: the model supplies snake_case
    // (multi_select) and may omit ids or options entirely.
    const questions: UserQuestion[] = raw.map((q, i) => {
      const o = (q ?? {}) as Record<string, unknown>;
      const options = Array.isArray(o.options)
        ? (o.options as Array<Record<string, unknown>>)
            .filter((opt) => opt && typeof opt.label === 'string' && opt.label.trim())
            .map((opt) => ({ label: String(opt.label), description: typeof opt.description === 'string' ? opt.description : undefined }))
        : undefined;
      return {
        id: typeof o.id === 'string' && o.id.trim() ? o.id : `q${i + 1}`,
        question: String(o.question ?? '').trim() || '(no question text)',
        header: typeof o.header === 'string' ? o.header : undefined,
        options: options && options.length ? options : undefined,
        multiSelect: o.multi_select === true || o.multiSelect === true
      };
    });

    const answers = await userQuestions.ask(questions, ctx.conversationId);
    return { content: formatAnswers(questions, answers), meta: { answers } };
  },

  async run_shell(args, ctx) {
    const { command, cwd, timeout_ms } = args as { command: string; cwd?: string; timeout_ms?: number; run_in_background?: boolean };
    const base = cwd ? safeResolve(cwd, ctx.cwd) : ctx.cwd;
    const timeout = timeout_ms || 30_000;

    if ((args as { run_in_background?: unknown }).run_in_background === true && backgroundJobsEnabled()) {
      const job = startShellJob({ command, cwd: base, conversationId: ctx.conversationId });
      return {
        content: `Started ${job.id} in the background: ${command}\nRead it with job_output({ job_id: "${job.id}" }), stop it with job_kill. Nothing is waiting on it.`,
        meta: { jobId: job.id, background: true }
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: base,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
      });
      const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
      return { content: out.slice(0, 50_000) || '(no output)' };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return { content: `[exit ${(err as { code?: number }).code ?? 'err'}]\n${e.stdout || ''}${e.stderr ? '\n[stderr]\n' + e.stderr : ''}\n${e.message || ''}`, isError: true };
    }
  },

  async job_list(args, ctx) {
    const all = (args as { all?: unknown }).all === true;
    const records = jobs.list(all ? undefined : ctx.conversationId);
    if (records.length === 0) return { content: 'No background jobs.', meta: { jobs: [] } };
    const lines = records.map((r) => {
      const ran = Math.round(((r.endedAt ?? Date.now()) - r.startedAt) / 1000);
      const state = r.status === 'running' ? 'running' : r.status === 'exited' ? `exited ${r.exitCode ?? '?'}` : r.status;
      return `${r.id}  [${state}]  ${ran}s  ${r.totalChars} chars  ${r.label}`;
    });
    return { content: lines.join('\n'), meta: { jobs: records } };
  },

  async job_output(args, ctx) {
    const { job_id, cursor, max_chars } = args as { job_id?: string; cursor?: number; max_chars?: number };
    if (!job_id) return { content: 'job_id is required.', isError: true };
    const record = jobs.get(job_id);
    if (!record) return { content: `Unknown job: ${job_id}. Use job_list to see what is running.`, isError: true };
    // A job belongs to the conversation that started it; reading another
    // conversation's output would leak across sessions.
    if (record.conversationId !== ctx.conversationId) {
      return { content: `${job_id} belongs to another conversation.`, isError: true };
    }
    const read = jobs.read(job_id, Math.max(0, Number(cursor) || 0), max_chars ? Math.max(1, Number(max_chars)) : undefined);
    if (!read) return { content: `Unknown job: ${job_id}`, isError: true };

    const header = [
      `${job_id} [${record.status}${record.status === 'exited' ? ` ${record.exitCode ?? '?'}` : ''}]`,
      read.dropped ? ` — ${read.dropped} characters scrolled out of the buffer before this read` : '',
      read.done ? ' — end of output' : ` — next cursor ${read.cursor}`
    ].join('');
    return {
      content: `${header}\n${read.text || '(no new output)'}`,
      meta: { jobId: job_id, cursor: read.cursor, done: read.done, status: record.status, exitCode: record.exitCode }
    };
  },

  async job_kill(args, ctx) {
    const { job_id } = args as { job_id?: string };
    if (!job_id) return { content: 'job_id is required.', isError: true };
    const record = jobs.get(job_id);
    if (!record) return { content: `Unknown job: ${job_id}`, isError: true };
    if (record.conversationId !== ctx.conversationId) return { content: `${job_id} belongs to another conversation.`, isError: true };
    const killed = jobs.kill(job_id);
    return { content: killed ? `Killed ${job_id}.` : `${job_id} had already finished (${record.status}).` };
  },

  async git_status(args, ctx) {
    const cwd = await gitCwd(args, ctx);
    if (typeof cwd !== 'string') return cwd;
    const r = await runGit(['status', '--porcelain=v1', '-b', '-z'], cwd);
    if (r.code !== 0) return { content: `git status failed: ${r.stderr.trim()}`, isError: true };
    const status = parseStatus(r.stdout);
    return { content: formatStatus(status), meta: { git: status } };
  },

  async git_diff(args, ctx) {
    const cwd = await gitCwd(args, ctx);
    if (typeof cwd !== 'string') return cwd;
    const { path, staged, base, stat } = args as { path?: string; staged?: boolean; base?: string; stat?: boolean };
    const argv = ['diff'];
    if (staged) argv.push('--staged');
    if (stat) argv.push('--stat');
    if (base) { assertSafeArg('base', base); argv.push(base); }
    // Everything after `--` is a path, so a file called "-x" cannot become a flag.
    if (path) argv.push('--', path);
    const r = await runGit(argv, cwd);
    if (r.code !== 0) return { content: `git diff failed: ${r.stderr.trim()}`, isError: true };
    const out = r.stdout.trim();
    return { content: out || '(no changes)', meta: { staged: !!staged, base: base ?? null } };
  },

  async git_log(args, ctx) {
    const cwd = await gitCwd(args, ctx);
    if (typeof cwd !== 'string') return cwd;
    const { max_count, path, author } = args as { max_count?: number; path?: string; author?: string };
    const count = Math.min(200, Math.max(1, Number(max_count) || 20));
    const argv = ['log', `--max-count=${count}`, `--pretty=format:${LOG_FORMAT}`];
    if (author) { assertSafeArg('author', author); argv.push(`--author=${author}`); }
    if (path) argv.push('--', path);
    const r = await runGit(argv, cwd);
    if (r.code !== 0) return { content: `git log failed: ${r.stderr.trim()}`, isError: true };
    const commits = parseLog(r.stdout);
    if (!commits.length) return { content: '(no commits)', meta: { commits: [] } };
    return {
      content: commits.map((c) => `${c.shortHash}  ${c.date.slice(0, 10)}  ${c.author}  ${c.subject}`).join('\n'),
      meta: { commits }
    };
  },

  async git_branch(args, ctx) {
    const cwd = await gitCwd(args, ctx);
    if (typeof cwd !== 'string') return cwd;
    const { create, switch_to, remote } = args as { create?: string; switch_to?: string; remote?: boolean };
    if (create && switch_to) return { content: 'Pass either create or switch_to, not both.', isError: true };

    if (create) {
      assertSafeArg('branch name', create);
      const r = await runGit(['checkout', '-b', create], cwd);
      if (r.code !== 0) return { content: `git checkout -b failed: ${r.stderr.trim()}`, isError: true };
      return { content: `Created and switched to ${create}.`, meta: { branch: create, created: true } };
    }
    if (switch_to) {
      assertSafeArg('branch name', switch_to);
      const r = await runGit(['checkout', switch_to], cwd);
      if (r.code !== 0) return { content: `git checkout failed: ${r.stderr.trim()}`, isError: true };
      return { content: `Switched to ${switch_to}.`, meta: { branch: switch_to } };
    }

    const argv = ['branch', '--format=%(refname:short)%09%(HEAD)'];
    if (remote) argv.push('-a');
    const r = await runGit(argv, cwd);
    if (r.code !== 0) return { content: `git branch failed: ${r.stderr.trim()}`, isError: true };
    const branches = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, head] = l.split('\t');
      return { name, current: head === '*' };
    });
    return {
      content: branches.map((b) => `${b.current ? '*' : ' '} ${b.name}`).join('\n') || '(no branches)',
      meta: { branches, current: branches.find((b) => b.current)?.name ?? null }
    };
  },

  async git_commit(args, ctx) {
    const cwd = await gitCwd(args, ctx);
    if (typeof cwd !== 'string') return cwd;
    const { message, all, paths } = args as { message?: string; all?: boolean; paths?: string[] };
    if (!message || !message.trim()) return { content: 'A commit message is required.', isError: true };

    if (Array.isArray(paths) && paths.length) {
      const add = await runGit(['add', '--', ...paths.map(String)], cwd);
      if (add.code !== 0) return { content: `git add failed: ${add.stderr.trim()}`, isError: true };
    }
    // No --no-verify: a hook that fails is telling the truth about the change.
    const argv = ['commit', '-m', message];
    if (all) argv.push('-a');
    const r = await runGit(argv, cwd);
    if (r.code !== 0) {
      const detail = (r.stdout + '\n' + r.stderr).trim();
      return { content: `git commit failed:\n${detail}`, isError: true };
    }
    const head = await runGit(['rev-parse', '--short', 'HEAD'], cwd);
    return {
      content: `Committed ${head.stdout.trim() || '(unknown)'}: ${message.split('\n')[0]}`,
      meta: { commit: head.stdout.trim(), message }
    };
  },

  async git_push(args, ctx) {
    const cwd = await gitCwd(args, ctx);
    if (typeof cwd !== 'string') return cwd;
    const { remote, branch, set_upstream } = args as { remote?: string; branch?: string; set_upstream?: boolean };
    const remoteName = remote || 'origin';
    assertSafeArg('remote', remoteName);
    const argv = ['push'];
    if (set_upstream) argv.push('-u');
    argv.push(remoteName);
    if (branch) { assertSafeArg('branch', branch); argv.push(branch); }
    const r = await runGit(argv, cwd, 120_000);
    if (r.code !== 0) return { content: `git push failed:\n${(r.stdout + '\n' + r.stderr).trim()}`, isError: true };
    return { content: `Pushed to ${remoteName}${branch ? `/${branch}` : ''}.\n${(r.stderr || r.stdout).trim()}` };
  },

  async lsp(args, ctx) {
    const action = String((args as { action?: unknown }).action || '') as LspAction;
    const path = String((args as { path?: unknown }).path || '');
    if (!['definition', 'references', 'hover', 'diagnostics', 'symbols'].includes(action)) {
      return { content: `Unknown action: ${action || '(none)'}. Use definition, references, hover, diagnostics or symbols.`, isError: true };
    }
    if (!path) return { content: 'path is required.', isError: true };
    const abs = safeResolve(path, ctx.cwd);
    if (!existsSync(abs)) return { content: `Error: file not found: ${abs}`, isError: true };
    if ((action === 'definition' || action === 'references' || action === 'hover') && !(args as { line?: unknown }).line) {
      return { content: `${action} needs a 1-based line (and ideally character) pointing at the symbol.`, isError: true };
    }
    try {
      return await runLsp({
        action,
        path: abs,
        line: Number((args as { line?: unknown }).line) || 1,
        character: Number((args as { character?: unknown }).character) || 1,
        root: ctx.cwd
      });
    } catch (err) {
      return { content: `lsp ${action} failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },

  async web_search(args) {
    const query = String((args as { query?: unknown }).query || '').trim();
    if (!query) return { content: 'A query is required.', isError: true };
    const count = Number((args as { count?: unknown }).count) || 5;
    try {
      const results = await webSearch(query, count);
      return { content: formatResults(query, results), meta: { query, results } };
    } catch (err) {
      return { content: `web_search failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },

  async web_fetch(args) {
    const url = String((args as { url?: unknown }).url || '').trim();
    if (!url) return { content: 'A url is required.', isError: true };
    try {
      const res = await fetchUrl(url);
      if (!res.ok) return { content: res.text, isError: true, meta: { url, finalUrl: res.finalUrl, status: res.status } };
      const note = [
        res.finalUrl !== url ? `Redirected to ${res.finalUrl}` : '',
        res.truncated ? `Body truncated at 2 MB (${res.bytes} bytes read)` : ''
      ].filter(Boolean).join(' · ');
      return {
        content: `${note ? `[${note}]\n\n` : ''}${res.text || '(empty response)'}`,
        meta: { url, finalUrl: res.finalUrl, status: res.status, contentType: res.contentType, bytes: res.bytes, truncated: res.truncated }
      };
    } catch (err) {
      return { content: `web_fetch failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },

  async todo_write(args) {
    const { todos } = args as { todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; active_form?: string }> };
    const formatted = todos.map((t) => `[${t.status === 'completed' ? 'x' : t.status === 'in_progress' ? '~' : ' '}] ${t.content}`).join('\n');
    return { content: formatted, meta: { todos } };
  },

  async lint_dvm_basic(args) {
    const { source } = args as { source: unknown };
    if (typeof source !== 'string') return { content: 'Error: source must be a string.', isError: true };
    if (source.length > 250_000) return { content: 'Error: source exceeds the 250 KB analysis limit.', isError: true };
    const result = lintDvmBasic(source);
    const summary = `${result.valid ? 'No structural errors' : 'Structural errors found'}; ${result.functions.length} function(s), ${result.findings.length} finding(s).`;
    return { content: `${summary}\n${JSON.stringify(result, null, 2)}`, meta: { dvmLint: result } };
  },

  async generate_dvm_contract(args) {
    const { name, brief } = args as { name: unknown; brief: unknown };
    if (!name || typeof name !== 'string' || !brief || typeof brief !== 'string') {
      return { content: 'Both "name" (PascalCase) and "brief" (contract specification) are required.', isError: true };
    }
    const contractName = String(name);
    const contractBrief = String(brief);
    return {
      content: `Contract brief received. Generate a complete DVM-BASIC contract named "${contractName}" from this specification. Use lint_dvm_basic after generating to validate structure.\n\n## Specification\n${contractBrief}\n\n## Requirements\n- Use Function/End Function with line-numbered statements\n- Include SIGNER() guards on state-changing functions\n- Use STORE()/LOAD() for persistent state\n- Include Initialize() or InitializePrivate()\n- Every function must RETURN\n\nRespond with the source inside \`\`\`basic ... \`\`\`\n\nThen run lint_dvm_basic on the result to validate.`,
      meta: { contractName }
    };
  },

  async get_simulator_chain_info() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetch('http://127.0.0.1:20000/json_rpc', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: 'dero-hive-tool', method: 'DERO.GetInfo' })
      });
      const body = await response.json() as { result?: Record<string, unknown>; error?: { message?: string } };
      if (!response.ok || body.error || !body.result) return { content: `Error: ${body.error?.message || `Simulator RPC HTTP ${response.status}`}`, isError: true };
      const result = body.result;
      const summary = {
        network: result.network, height: result.height, topoHeight: result.topoheight,
        txPoolSize: result.tx_pool_size, status: result.status, version: result.version
      };
      return { content: JSON.stringify(summary, null, 2), meta: { simulator: summary } };
    } catch (error) {
      return { content: `Error: local simulator unavailable: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    } finally { clearTimeout(timeout); }
  },

  async simulator_create_wallet() {
    const mgr = getSimulatorManager();
    if (!mgr) return { content: 'Simulator is not available.', isError: true };
    try {
      const w = await mgr.createFixtureWallet();
      return { content: `Created fixture wallet.\nAddress: ${w.address}`, meta: { walletAddress: w.address, scid: w.scid } };
    } catch (err) {
      return { content: `Simulator wallet creation failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },

  async simulator_get_balance(args) {
    const mgr = getSimulatorManager();
    if (!mgr) return { content: 'Simulator is not available.', isError: true };
    const { address } = args;
    if (!address || typeof address !== 'string') return { content: 'address is required.', isError: true };
    try {
      const b = await mgr.getBalance(String(address), typeof args.scid === 'string' ? args.scid : undefined);
      return { content: `Balance for ${String(address)}: ${b.balance}`, meta: b };
    } catch (err) {
      return { content: `Balance lookup failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },

  async simulator_get_contract_state(args) {
    const mgr = getSimulatorManager();
    if (!mgr) return { content: 'Simulator is not available.', isError: true };
    const { scid } = args;
    if (!scid || typeof scid !== 'string') return { content: 'scid is required.', isError: true };
    try {
      const keys = typeof args.keys === 'string' && args.keys.trim() ? args.keys.split(',').map((k: string) => k.trim()) : undefined;
      const state = await mgr.getContractState(String(scid), keys);
      return { content: JSON.stringify(state, null, 2), meta: { scid: String(scid) } };
    } catch (err) {
      return { content: `Contract state read failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },

  async simulator_get_height() {
    const mgr = getSimulatorManager();
    if (!mgr) return { content: 'Simulator is not available.', isError: true };
    try {
      const height = await mgr.getHeight();
      return { content: `Simulator block height: ${height}`, meta: { height } };
    } catch (err) {
      return { content: `Height lookup failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },

  async audit_dvm_contract(args) {
    const source = typeof (args as { source?: unknown }).source === 'string' ? (args as { source: string }).source : '';
    const contractName = typeof (args as { contractName?: unknown }).contractName === 'string' ? (args as { contractName: string }).contractName : 'Contract';
    if (!source.trim()) return { content: 'source is required for audit.', isError: true };

    const lintResult = lintDvmBasic(source);

    const checklist = [
      'ACCESS_CONTROL: Verify SIGNER() guards on all state-changing public functions. Check that Initialize/InitializePrivate is correctly scoped.',
      'FUND_SAFETY: Trace DERO and token transfers. Verify DEROVALUE() is checked before acceptance. Confirm amounts use proper bounds.',
      'STATE_INTEGRITY: Validate STORE/LOAD key consistency. Check for data races or interleaving issues across functions.',
      'REENTRANCY: Identify functions that modify state after external calls (SC_INVOKE, SEND_DERO_TO_ADDRESS). Verify checks-effects-interactions pattern.',
      'OVERFLOW: Check arithmetic operations (ADD, SUB, MUL, DIV) for overflow/underflow. Verify maximum values are guarded.',
      'INITIALIZATION: Confirm Initialize() runs once. Check that critical state keys are initialized before use.',
      'DENIAL_OF_SERVICE: Identify unbounded loops, excessive storage writes, or gas-heavy operations that could block the contract.',
      'PRIVACY: Note any plaintext storage of sensitive data on the public blockchain. Flag missing encryption patterns.',
      'VALIDATION: Check input parameter validation. Confirm addresses, amounts, and IDs are verified before use.',
      'UPGRADEABILITY: Check if the contract supports upgrades and whether the upgrade path is properly guarded.'
    ];

    return {
      content: `## DERO Security Audit: ${contractName}\n\n### Structural Lint\n${lintResult.findings.length} finding(s):\n${lintResult.findings.map(f => `- [${f.severity.toUpperCase()}] ${f.code}${f.line ? ` (line ${f.line})` : ''}: ${f.message}`).join('\n') || 'None'}\n\n### Audit Checklist\nReview each category against the source, reporting findings with:\n- **SEVERITY**: Critical / High / Medium / Low / Info\n- **LINES**: Affected line number(s)\n- **EXPLOIT**: Concrete failure scenario\n- **REPRODUCTION**: How to reproduce on simulator\n- **REMEDIATION**: Minimal code fix\n\n${checklist.map((c, i) => `**${i + 1}. ${c}**\n> Audit this category and report findings or "PASS".`).join('\n\n')}\n\n### Contract Source\n\`\`\`basic\n${source.slice(0, 6000)}${source.length > 6000 ? '\n... (truncated)' : ''}\n\`\`\`\n\nRun lint_dvm_basic on the source first, then review each checklist category systematically. Report ALL findings found, not just the most severe.`,
      meta: { contractName, lintFindings: lintResult.findings, checklistCategories: checklist.map(c => c.split(':')[0]) }
    };
  },

  async generate_tela_dapp(args, ctx: ToolContext) {
    const name = String((args as { name?: unknown }).name || '');
    const description = String((args as { description?: unknown }).description || '');
    if (!name.trim()) return { content: 'dApp name is required.', isError: true };

    const dir = `${ctx.cwd.replace(/[\\/]$/, '')}/tela/${name}`;
    const files: Record<string, string> = {
      'contract.bas': `' DERO TELA Contract: ${name}
' Generated by DERO Hive TELA Builder
Function Initialize() Uint64
1  STORE("owner", SIGNER())
2  STORE("name", "${name}")
3  RETURN 0
End Function

Function GetOwner() Uint64
10 RETURN LOAD("owner")
End Function
`,
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name} — DERO TELA dApp</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app">
    <header><h1>${name}</h1></header>
    <main><div id="output">Connecting to DERO network...</div></main>
    <footer>Powered by DERO Hive</footer>
  </div>
  <script src="mock-xswd.js?mock=1"></script>
  <script src="app.js"></script>
</body>
</html>
`,
      'styles.css': `* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0f; color: #e0e0e0; min-height: 100vh; }
#app { max-width: 800px; margin: 0 auto; padding: 2rem; }
header h1 { font-size: 1.5rem; color: #7cffc4; margin-bottom: 1rem; }
main { background: #12121a; border-radius: 12px; padding: 2rem; border: 1px solid #1e1e2e; }
footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #1e1e2e; color: #555; font-size: 0.75rem; text-align: center; }
#output { padding: 1rem; background: #0a0a12; border-radius: 8px; font-family: monospace; font-size: 0.85rem; min-height: 4rem; }
.btn { background: #1e1e2e; border: 1px solid #333; color: #e0e0e0; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; }
.btn:hover { background: #2a2a3e; }
`,
      'app.js': `// ${name} — DERO TELA dApp
// XSWD connection with read-only mock support
let dero = null;
const output = document.getElementById('output');

async function connectWallet() {
  try {
    if (typeof window.xswd !== 'undefined') {
      dero = window.xswd;
      output.textContent = 'Connected to DERO wallet via XSWD.';
      void checkNetwork();
    } else {
      output.textContent = 'No XSWD wallet detected. Using read-only mode.';
    }
  } catch (err) {
    output.textContent = 'Connection error: ' + err.message;
  }
}

async function checkNetwork() {
  if (!dero) return;
  try {
    const info = await dero.request({ method: 'DERO.GetInfo' });
    output.textContent = 'Network: ' + info.network + ' | Height: ' + info.height;
  } catch (err) {
    output.textContent = 'Network check failed: ' + err.message;
  }
}

document.addEventListener('DOMContentLoaded', function() {
  void connectWallet();
});
`,
      'mock-xswd.js': `// Mock XSWD bridge for local development
// Replace with real XSWD for wallet operations
(function() {
  if (new URLSearchParams(location.search).get('mock') !== '1') return;
  var mockRpc = {
    'DERO.GetInfo': function() { return { height: 12345, network: 'simulator', topoheight: 12345, version: 'mock', tx_pool_size: 0, status: 'OK' }; },
    'DERO.GetHeight': function() { return { height: 12345 }; },
    'DERO.GetEncryptedBalance': function() { return { balance: 1000000, unlocked_balance: 1000000 }; }
  };
  window.xswd = {
    request: async function(req) {
      var method = req.method || (req.params && req.params.method);
      var handler = mockRpc[method];
      if (handler) return handler();
      return { error: 'Mock: method ' + method + ' not available in read-only fixture' };
    },
    wallet: { connected: true, address: 'dero1mock0000000000000000000000000000000000000000000000000000000000', network: 'simulator' }
  };
})();
`,
      'tela.config.json': JSON.stringify({
        name,
        version: '1.0.0',
        description,
        contract: 'contract.bas',
        entry: 'index.html',
        documents: ['index.html', 'styles.css', 'app.js', 'mock-xswd.js'],
        permissions: ['read-only'],
        xswd: { mock: true, readOnly: true },
        deployment: { network: 'simulator', estimatedGas: 50000 }
      }, null, 2)
    };

    try {
      await mkdir(dir, { recursive: true });
      for (const [filename, content] of Object.entries(files)) {
        await writeFile(join(dir, filename), content, 'utf-8');
      }
      return {
        content: `TELA dApp "${name}" scaffolded at tela/${name}/ with ${Object.keys(files).length} files: contract.bas, index.html, styles.css, app.js, mock-xswd.js, tela.config.json.`,
        meta: { telaName: name, telaDir: `tela/${name}`, fileCount: Object.keys(files).length }
      };
    } catch (err) {
      return { content: `TELA dApp scaffolding failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },

  async discover_contracts(args) {
    const query = typeof (args as { query?: unknown }).query === 'string' ? (args as { query: string }).query : '';
    const kind = (typeof (args as { kind?: unknown }).kind === 'string' ? (args as { kind: string }).kind : 'similar-contracts') as IndexQuery['kind'];

    return {
      content: `## Contract Discovery Request

**Query:** ${query || '(broad discovery)'}
**Kind:** ${kind}

Use the connected DERO MCP tools to discover contracts matching this query:

1. If a Gnomon instance is connected, use its indexed contract search
2. Otherwise, use \`dero_tela_list_apps\` for TELA dApps
3. Use \`dero_get_sc\` to inspect individual contracts by SCID
4. Use \`explain_smart_contract\` to get contract metadata

### Discovery Strategy
- **similar-contracts**: Find contracts with similar bytecode or function signatures
- **by-function**: Find all contracts implementing a specific function name
- **by-transaction**: Find contracts involved in recent transactions
- **tela-apps**: List all TELA dApps deployed on the connected network

Present results with: SCID, name, deploy height, key functions, and related contracts. If Gnomon is unavailable, explain that only daemon-level inspection is possible (GetSC by known SCID).`,
      meta: { kind, query }
    };
  },

  async generate_image(args, ctx) {
    const { prompt, aspect } = args as { prompt?: string; aspect?: 'square' | 'portrait' | 'landscape' };
    return runMediaGeneration('image', String(prompt || ''), ctx, { aspect });
  },

  async generate_audio(args, ctx) {
    const { text, voice } = args as { text?: string; voice?: string };
    return runMediaGeneration('audio', String(text || ''), ctx, { voice });
  },

  async generate_video(args, ctx) {
    const { prompt, duration_seconds } = args as { prompt?: string; duration_seconds?: number };
    return runMediaGeneration('video', String(prompt || ''), ctx, { durationSeconds: duration_seconds });
  }
};

/**
 * Resolve the repository directory for a git tool, or return the error result
 * the caller should hand back. Every git tool starts here so "not a repo" reads
 * the same way, and so a `cwd` argument goes through the same path policy as
 * every other file-taking tool.
 */
async function gitCwd(args: Record<string, unknown>, ctx: ToolContext): Promise<string | ToolResult> {
  const raw = typeof args.cwd === 'string' && args.cwd ? args.cwd : null;
  let dir: string;
  try {
    dir = raw ? safeResolve(raw, ctx.cwd) : ctx.cwd;
  } catch (err) {
    return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
  if (!existsSync(dir)) return { content: `Error: directory not found: ${dir}`, isError: true };
  try {
    if (!(await isRepo(dir))) return { content: `Not a git repository: ${dir}`, isError: true };
  } catch (err) {
    return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
  return dir;
}

const MEDIA_ASPECTS: Record<string, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  portrait: { width: 1024, height: 1792 },
  landscape: { width: 1792, height: 1024 }
};

const MEDIA_SETUP_HINT: Record<MediaKind, string> = {
  image: 'No image generator is configured. Open Settings → Media and add a provider (Pollinations needs no API key), or connect a model provider that offers image models, then ask again.',
  audio: 'No speech generator is configured. Open Settings → Media and add OpenAI or ElevenLabs speech, or connect an image/speech-capable model provider, then ask again.',
  video: 'No video generator is configured. Video needs a dedicated media provider such as Replicate or ComfyUI — add one in Settings → Media, then ask again.'
};

async function runMediaGeneration(
  kind: MediaKind,
  prompt: string,
  ctx: ToolContext,
  opts: { aspect?: 'square' | 'portrait' | 'landscape'; voice?: string; durationSeconds?: number }
): Promise<ToolResult> {
  if (!prompt.trim()) return { content: 'Error: a non-empty prompt/text is required.', isError: true };
  const mgr = getMediaManager();
  if (!mgr) return { content: 'Media generation is unavailable in this session.', isError: true };

  const pick = mgr.autoPick(kind);
  if (!pick) return { content: MEDIA_SETUP_HINT[kind], isError: true };

  const req: MediaGenerationRequest = { prompt: prompt.trim(), kind, ...pick };
  if (kind === 'image') {
    const a = MEDIA_ASPECTS[opts.aspect || 'square'] || MEDIA_ASPECTS.square;
    req.width = a.width;
    req.height = a.height;
  } else if (kind === 'video') {
    req.durationSeconds = Math.max(1, Math.min(60, Math.round(opts.durationSeconds ?? 5)));
  } else if (kind === 'audio' && opts.voice) {
    req.voice = opts.voice;
  }

  try {
    const art = await mgr.generate(req, { conversationId: ctx.conversationId });
    if (process.env.HIVE_CLI) {
      const copied = await mgr.copyArtifactToProject(art.id, ctx.cwd, 'hive');
      return {
        content: copied.ok && copied.path
          ? `Generated ${kind} with ${art.model} and saved it to: ${copied.path}`
          : `Generated ${kind} with ${art.model}. It is stored in the Hive media library as artifact ${art.id}.`,
        meta: {
          mediaArtifactId: art.id,
          mediaKind: art.kind,
          mediaMime: art.mimeType,
          mediaPrompt: art.prompt,
          ...(copied.path ? { mediaPath: copied.path } : {})
        }
      };
    }
    return {
      content: `Generated ${kind} and displayed it to the user (model: ${art.model}). Do not describe the pixels; the user can see it. Offer refinements if helpful.`,
      meta: { mediaArtifactId: art.id, mediaKind: art.kind, mediaMime: art.mimeType, mediaPrompt: art.prompt }
    };
  } catch (err) {
    return { content: `Media generation failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
