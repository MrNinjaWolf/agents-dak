# agents-dak

This repo is a Claude Code **plugin marketplace**. Its only plugin is `devkit`, a set of multi-agent workflows for developing, styling, tuning and bug-hunting in any language.

## Layout

- `.claude-plugin/marketplace.json`: the marketplace catalog.
- `plugins/devkit/`: the plugin itself.
  - `agents/`: six agents. They load as `devkit:<name>`.
  - `workflows/`: five workflows. They run as `/devkit:<name>`.
  - `skills/devkit/SKILL.md`
  - `scripts/devkit.py`: the toolchain helper.
  - `bin/devkit` and `bin/devkit.cmd`: launchers that find Python 3. They are on the shell `PATH` while the plugin is enabled.
- `scripts/dry-run-workflow.mjs`: tests a workflow with fake agents.
- `scripts/score.py` and `playground/`: the bug-hunt benchmark.

## Toolchain: always go through `devkit`

Don't guess a project's commands. Use these:

- `devkit detect <dir>`: lists the languages and projects, with their format, lint, build and test commands.
- `devkit run <format|format-check|lint|build|test|check> <dir> [--lang L]`: runs those commands and prints a JSON result. It exits 0 only if everything passed.
- `devkit slices <dir> --max-lines N`: splits the source files into chunks for parallel agents.

If you work in this repo without the plugin installed, run `plugins/devkit/bin/devkit` instead. If a language isn't detected, add it to `detect()` or `loose_cmds()` in `plugins/devkit/scripts/devkit.py`. Don't hard-code commands anywhere else.

## Editing agents and workflows

- In workflows, refer to agents by their namespaced name, e.g. `agentType: 'devkit:skeptic'`.
- Read-only roles (`bug-hunter`, `skeptic`, `reviewer`) never edit project files. They may write scratch files under `/tmp`.
- `export const meta = {...}` stays the first statement, written as a plain literal. Every `phase('X')` title needs an entry in `meta.phases`.
- Scripts can't use `import`, `Date.now()`, `Math.random()` or `new Date()`.
- After any workflow edit, run `node scripts/dry-run-workflow.mjs plugins/devkit/workflows/<name>.js` and keep it passing.
- After any plugin change, run `claude plugin validate plugins/devkit` and `claude plugin validate .`, then bump `version` in `plugin.json` so installed copies update.
- Claims from hunters and reviewers go through skeptics before anything is fixed or reported.

## Playground

`playground/` contains code with **deliberately planted bugs**. It is the benchmark for `/devkit:bug-hunt`. Unless the user explicitly asks, don't:

- fix those bugs,
- add comments that point at them,
- decode `scripts/.planted_key`.

Score a run with `python3 scripts/score.py reports/bug-hunt/result.json`.
