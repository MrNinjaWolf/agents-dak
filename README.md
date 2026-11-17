# agents-dak

A multi-agent setup for Claude Code for developing, styling, fine-tuning and bug-hunting in any language.

It is built on the idea from the "one head, one backpack" video. A single agent reads a big codebase into one context window and stops after it finds a dozen bugs. A **dynamic workflow** turns the plan into a program instead:

- many agents each hunt in their own slice,
- skeptic agents then try to **prove each finding wrong**,
- only the findings that survive get reported or fixed.

```
            ┌────────── Map ──────────┐
            │ toolchain.py slices     │
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

## What's inside

| Path | What it is |
| --- | --- |
| `.claude/workflows/` | Five workflow scripts. Each one runs as a slash command. |
| `.claude/agents/` | Six subagent roles that the workflows use (you can also call them directly). |
| `scripts/toolchain.py` | One interface for format / lint / build / test in any language. It detects Python, JS/TS, Go, Rust, Java/Kotlin, C/C++, C#, Ruby and shell. |
| `scripts/dry-run-workflow.mjs` | Runs a workflow with fake agents so you can test its logic without spending tokens. |
| `scripts/score.py` + `playground/` | A small benchmark with planted bugs, for measuring how well `/bug-hunt` does. |
| `CLAUDE.md` | Project rules that Claude reads at the start of every session. |

## Workflows

Run these inside Claude Code (CLI, desktop, IDE, or web) from the root of this repo. You can also copy `.claude/` and `scripts/` into another project and run them there.

| Command | What it does | Example |
| --- | --- | --- |
| `/bug-hunt` | Map → Hunt → Verify → (Fix) → Report. Writes `reports/bug-hunt/result.json` and `report.md`. | `/bug-hunt src` · `Run /bug-hunt with path "api", perSlice 3, skeptics 2, fix true` |
| `/fix-until-green` | Runs the checks, fixes failures in parallel (one agent per file), and repeats until everything passes or two rounds in a row make no progress. | `/fix-until-green` · `Run /fix-until-green with kind "test", path "services/billing"` |
| `/style-sweep` | Infers your house style from configs and code, runs the formatters, sends a stylist to each slice, then re-runs the checks. Behavior doesn't change. | `/style-sweep src` · `Run /style-sweep with guide "prefer early returns"` |
| `/tune` | Baseline benchmark → five proposers (algorithmic, allocation, I/O, concurrency, runtime) → ranks the proposals → applies them one at a time and keeps only measured wins. | `/tune src/parser.py` · `Run /tune with target "go/ratelimit", metric "allocations"` |
| `/develop` | Three planners (minimal / robust / idiomatic) → merge → implement with tests → five reviewers → a skeptic per review issue → fix what survives → checks pass. | `/develop "add a --json flag to the export command"` |

**Options** (pass them in plain words; Claude turns them into `args`):

- `bug-hunt`: `path` (`.`), `perSlice` max findings per hunter (3), `skeptics` per finding (2), `maxLines` per slice (1500), `fix` (false), `focus` (e.g. "concurrency and auth"), `outDir`
- `fix-until-green`: `path`, `kind` (`check` | `lint` | `test` | `build` | `format-check`), `maxRounds` (6), `lang`
- `style-sweep`: `path`, `maxLines` (800), `guide`
- `tune`: `target`, `metric` ("wall-clock time"), `angles`, `maxTries` (4)
- `develop`: `task`, `path`, `reviewAngles`, `includeLow`

While a workflow runs, open `/workflows` to watch each phase and agent. In that view, `p` pauses the run, `x` stops it, and `s` saves a script that Claude wrote for you into `.claude/workflows/`.

### Ad-hoc workflows

For a one-off job you don't need a saved script. Start the prompt with `ultracode:` or say "use a workflow", and Claude writes one:

```text
ultracode: audit every route under src/routes/ for missing auth checks, and adversarially verify each finding
```

To have Claude plan a workflow for every substantive task in a session, run `/effort ultracode`. This costs more tokens; turn it off with `/effort ultracode off`.

## Using the agents directly

You don't need a workflow to use the roles. Ask for one by name:

- "Use the **skeptic** agent to check whether the null check in `cache.go:88` is really a bug."
- "Have the **perf-tuner** benchmark `parse_rows` and propose changes, but don't apply them."
- "Have the **reviewer** look at my diff from the security angle."

## Toolchain helper

```bash
python3 scripts/toolchain.py detect .            # what languages, which commands
python3 scripts/toolchain.py run check .         # format-check + lint + build + test
python3 scripts/toolchain.py run test . --lang go
python3 scripts/toolchain.py run format src      # apply formatters
python3 scripts/toolchain.py slices . --max-lines 1500
```

The helper only uses tools that are installed. Missing tools are listed under `missing_tools`. To support a new language or tool, extend `detect()` or `loose_cmds()` in the script. Every agent and workflow picks up the change automatically.

## Try it on the benchmark

`playground/` holds small Python, JavaScript and Go modules with 10 planted bugs. Their own tests pass, so the bugs are hidden.

```text
/bug-hunt playground
```

```bash
python3 scripts/score.py reports/bug-hunt/result.json
```

To compare with one agent, ask a fresh session to "check playground/ for bugs" and score its list the same way. Reset after a run that used `fix: true` with `git checkout -- playground`.

## Writing or changing workflows

A workflow is plain JavaScript:

- `agent(prompt, { agentType, schema, label, model, effort, isolation: 'worktree' })` starts one agent.
- `pipeline(items, fn)` starts one agent per item.
- `phase(title)` groups the agents that follow in the progress view.
- `log(msg)` prints a line above the phases.
- `args` holds the input.

The runtime has a few rules: no `import`, no `Date.now()` or `Math.random()`, and `meta` has to be a literal and the first statement. Run `/workflow-authoring` in Claude Code to load the full reference.

Test changes without spending tokens:

```bash
node scripts/dry-run-workflow.mjs .claude/workflows/bug-hunt.js --args '{"path":"src","fix":true}'
node scripts/dry-run-workflow.mjs .claude/workflows/fix-until-green.js --fixtures my-fixtures.json
```

The dry run checks the runtime rules and runs the control flow with fake agents. Fake answers come from each agent's `schema`, or from a fixtures file that maps label substrings to responses.

## Optional: fewer permission prompts

Long runs ask for approval on every shell command the agents run. To pre-approve the safe helper commands, add these rules to `.claude/settings.json` (shared with the repo) or `.claude/settings.local.json` (just you):

```json
{
  "permissions": {
    "allow": [
      "Bash(python3 scripts/toolchain.py:*)",
      "Bash(python3 scripts/score.py:*)",
      "Bash(node scripts/dry-run-workflow.mjs:*)",
      "Bash(git diff:*)",
      "Bash(git status:*)",
      "Bash(git log:*)"
    ]
  }
}
```

Note that `toolchain.py run` executes the project's own scripts (`npm run test`, `make`, and so on). Only allow it in repos you trust. The first time a workflow launches, Claude Code asks for approval and offers "don't ask again" for that workflow.

## Cost

Workflows spawn many agents, so they use more tokens than a normal conversation. On a subscription plan, those tokens count toward your usage limits. Some ways to keep it down:

- Try a workflow on one directory first.
- Lower `perSlice` or `skeptics`.
- Set `/config workflowSizeGuideline=small`.
- Ask for a smaller model on the read-heavy stages.

`/workflows` shows token usage per agent while a run is going.
