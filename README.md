# agents-dak

**devkit** is a Claude Code plugin with multi-agent workflows for developing, styling, fine-tuning and bug-hunting in any language. You install it once and it's available in every project.

## Install (one command)

Run this in any Claude Code chat (CLI, desktop, IDE or web):

```text
/plugin install devkit --marketplace MrNinjaWolf/agents-dak
```

On Claude Code versions older than 2.1.275, use two steps:

```text
/plugin marketplace add MrNinjaWolf/agents-dak
/plugin install devkit@agents-dak
```

That's it. Every session now has the `/devkit:*` commands, the six agents, and the `devkit` toolchain helper. To get updates, open `/plugin`, go to Marketplaces, choose agents-dak, then Update. You can also turn on auto-update there.

### Make it automatic for everyone on a project

Commit this to the project's `.claude/settings.json`, for example in your web app's repo:

```json
{
  "extraKnownMarketplaces": {
    "agents-dak": { "source": { "source": "github", "repo": "MrNinjaWolf/agents-dak" } }
  },
  "enabledPlugins": {
    "devkit@agents-dak": true
  }
}
```

When anyone opens that project in Claude Code and trusts the folder, they're asked to install the marketplace and plugin. Nobody has to remember the install command.

## How it works

The idea comes from the "one head, one backpack" video. A single agent stuffs a whole codebase into one context window and stops after a dozen bugs. A **dynamic workflow** turns the plan into a program instead:

1. Many agents each hunt in their own slice of the code.
2. Skeptic agents then try to **prove each finding wrong**.
3. Only the findings that survive get reported or fixed.

```
            ┌────────── Map ──────────┐
            │      devkit slices      │
            └───────────┬─────────────┘
       ┌────────────────┼────────────────┐        Phase 1 · Hunt
  bug-hunter        bug-hunter       bug-hunter    (one per slice, ≤ N findings each)
       └────────────────┼────────────────┘
       ┌──────┬─────────┼─────────┬──────┐        Phase 2 · Verify
   skeptic skeptic   skeptic   skeptic skeptic     (k per finding, "prove it wrong")
       └──────┴─────────┼─────────┴──────┘
          confirmed / disputed / refuted
                        │                          Phase 3 · Fix (opt-in)
                 fixer per file ──► report.md + result.json
```

## Commands

| Command | What it does | Example |
| --- | --- | --- |
| `/devkit:bug-hunt` | Map → Hunt → Verify → (Fix) → Report. Writes `reports/bug-hunt/result.json` and `report.md`. | `/devkit:bug-hunt src` · `Run /devkit:bug-hunt with path "server", focus "auth and injection", fix true` |
| `/devkit:fix-until-green` | Runs the checks, fixes failures in parallel (one agent per file), and repeats until everything passes or two rounds in a row make no progress. | `/devkit:fix-until-green` · `Run /devkit:fix-until-green with kind "test"` |
| `/devkit:style-sweep` | Infers your house style, runs the formatters, sends a stylist to each slice, then re-checks. Behavior doesn't change. | `/devkit:style-sweep src` |
| `/devkit:tune` | Baseline benchmark, five proposers (algorithmic, allocation, I/O, concurrency, runtime), a ranking step, then applies the proposals one at a time and keeps only measured wins. | `/devkit:tune src/parser.py` |
| `/devkit:develop` | Three planners, a merged plan, implementation with tests, five reviewers, skeptics on the review issues, polish, then the checks pass. | `/devkit:develop "add a --json flag to export"` |

**Options** (give them in plain words; Claude turns them into `args`):

- `bug-hunt`: `path` (`.`), `perSlice` max findings per hunter (3), `skeptics` per finding (2), `maxLines` per slice (1500), `fix` (false), `focus`, `outDir`
- `fix-until-green`: `path`, `kind` (`check` | `lint` | `test` | `build` | `format-check`), `maxRounds` (6), `lang`
- `style-sweep`: `path`, `maxLines` (800), `guide`
- `tune`: `target`, `metric` ("wall-clock time"), `angles`, `maxTries` (4)
- `develop`: `task`, `path`, `reviewAngles`, `includeLow`

While a workflow runs, open `/workflows` to watch each agent. In that view, `p` pauses the run and `x` stops it.

### Example: checking a web app for bugs

Install dependencies first (`npm install`) so the skeptics can run tests and reproductions. Then hunt the backend and the frontend separately, each with its own focus:

```text
Run /devkit:bug-hunt with path "server", focus "missing auth checks, SQL/NoSQL injection, unvalidated input, missing await, swallowed errors, race conditions"
Run /devkit:bug-hunt with path "client/src", focus "XSS, stale state, effects with wrong dependencies, unhandled promise rejections, out-of-order fetches"
```

`devkit detect .` reads the `lint`, `test`, `build`, `typecheck` and `format` scripts from your `package.json`. The bug hunt reads code; it doesn't click through the running site. For bugs that only show up in the browser, ask Claude to start the dev server and walk through your main flows with Playwright.

## Agents

You can ask for any of these by name, without running a workflow:

- `devkit:bug-hunter`
- `devkit:skeptic`
- `devkit:fixer`
- `devkit:stylist`
- `devkit:perf-tuner`
- `devkit:reviewer`

For example: "Use the devkit:skeptic agent to check whether the null check in cache.go:88 is really a bug."

## Toolchain helper

The plugin puts `devkit` on the Bash `PATH`, so you and the agents get one interface for every language:

```bash
devkit detect .                  # languages, projects, commands (missing tools listed)
devkit run check .               # format-check + lint + build + test, JSON result
devkit run test . --lang go
devkit run format src
devkit slices . --max-lines 1500
```

It covers Python, JS/TS, Go, Rust, Java/Kotlin, C/C++, C#, Ruby and shell.

## Benchmark

`playground/` has small Python, JavaScript and Go modules with 10 planted bugs. Their own tests pass, so the bugs are hidden. To try it, clone this repo, open it in Claude Code, then:

```text
/devkit:bug-hunt playground
```

```bash
python3 scripts/score.py reports/bug-hunt/result.json
```

After a run with `fix true`, reset with `git checkout -- playground`.

## Working on the plugin

| Path | What it is |
| --- | --- |
| `.claude-plugin/marketplace.json` | The marketplace catalog |
| `plugins/devkit/workflows/` | Workflow scripts |
| `plugins/devkit/agents/` | Agent roles |
| `plugins/devkit/skills/devkit/` | Skill that teaches Claude when to use what |
| `plugins/devkit/bin/devkit` | Toolchain helper (Python, stdlib only) |
| `scripts/dry-run-workflow.mjs` | Runs a workflow with fake agents, so testing costs no tokens |

```bash
claude --plugin-dir plugins/devkit          # try local changes without reinstalling
node scripts/dry-run-workflow.mjs plugins/devkit/workflows/bug-hunt.js --args '{"path":"src","fix":true}'
claude plugin validate plugins/devkit && claude plugin validate .
```

Bump `version` in `plugins/devkit/.claude-plugin/plugin.json` when you publish changes, so installed copies update.

### Fewer permission prompts (optional)

Add these rules to your user or project settings:

```json
{ "permissions": { "allow": ["Bash(devkit:*)", "Bash(git diff:*)", "Bash(git status:*)", "Bash(git log:*)"] } }
```

`devkit run` executes the project's own scripts (`npm run test`, `make`, and so on), so only allow it in repos you trust.

## Cost

Workflows spawn many agents, so they use more tokens than a normal chat. To keep costs down:

- Start with one folder.
- Lower `perSlice` or `skeptics`.
- Set `/config workflowSizeGuideline=small`.

`/workflows` shows token use per agent while a run is going.
