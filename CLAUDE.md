# agents-dak

A multi-agent setup for developing, styling, tuning and bug-hunting in any language with Claude Code.

## Toolchain: always go through `scripts/toolchain.py`

Don't guess a project's commands. Use:

- `python3 scripts/toolchain.py detect <dir>`: languages, projects and their format/lint/build/test commands
- `python3 scripts/toolchain.py run <format|format-check|lint|build|test|check> <dir> [--lang L]`: run them; JSON result, exit 0 only if all pass
- `python3 scripts/toolchain.py slices <dir> --max-lines N`: split source files into chunks for parallel agents

If a language isn't detected, add it to `detect()` / `loose_cmds()` in that script instead of hard-coding commands elsewhere.

## Agents (`.claude/agents/`)

`bug-hunter`, `skeptic`, `fixer`, `stylist`, `perf-tuner`, `reviewer`. Read-only roles (`bug-hunter`, `skeptic`, `reviewer`) must never edit project files; they may write scratch files under `/tmp`.

## Workflows (`.claude/workflows/`)

`/bug-hunt`, `/fix-until-green`, `/style-sweep`, `/tune`, `/develop`. Rules for editing them:

- `export const meta = {...}` stays the first statement and a plain literal; every `phase('X')` title has an entry in `meta.phases`.
- No `import`, `Date.now()`, `Math.random()` or `new Date()` in scripts. Pass time-dependent values in through `args`.
- After any edit, run `node scripts/dry-run-workflow.mjs .claude/workflows/<name>.js` (fake agents, no tokens) and keep it passing.
- Claims from hunters and reviewers go through skeptics before anything is fixed or reported.

## Playground

`playground/` contains code with **deliberately planted bugs**. It is the benchmark for `/bug-hunt`. Don't fix those bugs, add comments that point at them, or decode `scripts/.planted_key` unless the user explicitly asks. Score a run with `python3 scripts/score.py reports/bug-hunt/result.json`.
