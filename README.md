# agents-dak

**devkit** is a Claude Code plugin with multi-agent workflows for developing, styling, fine-tuning and bug-hunting in any language. You install it once and it's available in every project.

## Install

Pick whichever app you use. Both install the same plugin.

### Option A: claude.ai or the Claude desktop app (no terminal)

1. Go to **Customize > Plugins** ([claude.ai/customize/plugins](https://claude.ai/customize/plugins), or **Customize** in the desktop app).
2. Select **Add**, then **Add marketplace**, and enter `MrNinjaWolf/agents-dak`.
3. Find **devkit** in the list and select **Add**.

The plugin is saved to your account. It works in Cowork and in Claude Code (run `/reload-plugins`, or start a new session). Chat only gets its skill; the agents and workflows need Cowork or Claude Code.

### Option B: inside Claude Code

Claude Code means the terminal app, an IDE extension, or the desktop app's **Code** tab. Type:

```text
/plugin install devkit --marketplace MrNinjaWolf/agents-dak
```

On Claude Code versions older than 2.1.275, use two steps instead: `/plugin marketplace add MrNinjaWolf/agents-dak`, then `/plugin install devkit@agents-dak`.

To get updates, open `/plugin`, go to **Marketplaces**, choose **agents-dak**, and select **Update** (or turn on auto-update).

### Requirements

- **Python 3.8 or newer** for the toolchain helper.
- **Git** for Claude Code installs.

On Windows, install all three from PowerShell, then close and reopen it:

```powershell
winget install --id Git.Git -e
winget install --id Python.Python.3.12 -e
irm https://claude.ai/install.ps1 | iex
```

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

The devkit helper reads the `lint`, `test`, `build`, `typecheck` and `format` scripts from your `package.json`. The bug hunt reads code; it doesn't click through the running site. For bugs that only show up in the browser, ask Claude to start the dev server and walk through your main flows with Playwright.

## Agents

You can ask for any of these by name, without running a workflow:

- `devkit:bug-hunter`
- `devkit:skeptic`
- `devkit:fixer`
- `devkit:stylist`
- `devkit:perf-tuner`
- `devkit:reviewer`
- `devkit:runner` (the general helper the workflows use for setup and reporting steps)

For example: "Use the devkit:skeptic agent to check whether the null check in cache.go:88 is really a bug."

## Betting desk plugin

The marketplace also has **betting-desk**, a six-agent panel for sports betting research. Install it the same way (`/plugin install betting-desk --marketplace MrNinjaWolf/agents-dak`), then run:

```text
/betting-desk:bet "Lakers vs Celtics tonight"
Run /betting-desk:bet with topic "NFL week 12 totals", maxBets 3, maxStake 1, books "DraftKings, FanDuel"
```

| # | Agent | Role |
| --- | --- | --- |
| 1 | `betting-desk:lead` | Makes every final decision: approve or reject, stake in units, worst price to accept |
| 2 | `betting-desk:skeptic` | Tries to veto every proposed bet, then second-guesses the lead's decisions |
| 3 | `betting-desk:researcher` | Primary research on your topic: context, injuries, form, matchups, odds, news |
| 4 | `betting-desk:bet-scout` | Finds bets with an edge in agent 3's research |
| 5 | `betting-desk:second-researcher` | Independent research from different sources, used to cross-check |
| 6 | `betting-desk:research-skeptic` | Fact-checks both researchers before anyone bets on their claims |

```
   researcher (3) ──┬── second-researcher (5)       Research, in parallel
                    ▼
            research-skeptic (6)                    Fact-check both briefs
                    ▼
              bet-scout (4)                         Proposes bets from agent 3's research
                    ▼
        skeptic (2) on each bet                     Veto / downgrade / pass
                    ▼
                lead (1)  ◄──  skeptic (2)          Decide, get challenged, final call
                    ▼
     reports/betting-desk/<topic>.md
```

The workflow computes implied probability and edge from the American odds itself, caps stakes at `maxStake`, and treats "no bet" as a valid result. It is analysis, not a guarantee: bet only where it's legal and only what you can afford to lose.

## Toolchain helper

The plugin ships `scripts/devkit`, which gives the agents one interface for every language: Python, JS/TS, Go, Rust, Java/Kotlin, C/C++, C#, Ruby and shell. The agents find it on their own. You can also just ask Claude, for example "run devkit check on this repo".

From a clone of this repo, you can run it yourself:

```bash
plugins/devkit/scripts/devkit detect .        # languages, projects, commands (missing tools listed)
plugins/devkit/scripts/devkit run check .     # format-check + lint + build + test, JSON result
plugins/devkit/scripts/devkit run test . --lang go
plugins/devkit/scripts/devkit slices . --max-lines 1500
```

On Windows CMD or PowerShell, use `plugins\devkit\scripts\devkit.cmd` instead.

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
| `plugins/devkit/scripts/devkit.py` | Toolchain helper (Python 3.8+, stdlib only) |
| `plugins/devkit/scripts/devkit`, `devkit.cmd` | Launchers for macOS/Linux/Git Bash and Windows CMD/PowerShell. The plugin has no top-level `bin/` because claude.ai rejects plugins that have one. |
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
{ "permissions": { "allow": ["Bash(git diff:*)", "Bash(git status:*)", "Bash(git log:*)"] } }
```

When an agent first runs the devkit helper, choose "don't ask again" to approve it for the rest of the session. `devkit run` executes the project's own scripts (`npm run test`, `make`, and so on), so only allow it in repos you trust.

## Cost

Workflows spawn many agents, so they use more tokens than a normal chat. To keep costs down:

- Start with one folder.
- Lower `perSlice` or `skeptics`.
- Set `/config workflowSizeGuideline=small`.

`/workflows` shows token use per agent while a run is going.
