---
name: devkit
description: How to check, lint, format, build, test, bug-hunt, restyle or performance-tune code in any language with the devkit plugin. Use when running a project's checks, finding or fixing bugs, cleaning up style, speeding code up, or choosing between the devkit workflows and agents.
---

# Devkit

## The `devkit` command

The helper lives at `"${CLAUDE_PLUGIN_ROOT}/scripts/devkit"`. In PowerShell or CMD on Windows, use `& "${CLAUDE_PLUGIN_ROOT}/scripts/devkit.cmd"`. It needs Python 3.8 or newer. Below, `devkit` stands for that path. Use it instead of guessing a project's commands:

- `devkit detect [dir]`: lists the languages and projects under `dir`, with each project's format, lint, build and test commands. Tools that aren't installed appear under `missing_tools`.
- `devkit run <format|format-check|lint|build|test|check> [dir] [--lang L]`: runs those commands and prints a JSON result. It exits 0 only if every command passed. `check` runs format-check, lint, build and test in that order.
- `devkit slices [dir] --max-lines N`: splits the source files into chunks for parallel agents.

It covers Python, JavaScript/TypeScript (including `package.json` scripts), Go, Rust, Java/Kotlin (Maven/Gradle), C/C++ (CMake/Make), C#, Ruby and shell.

## Workflows

Suggest one of these when the job is bigger than one conversation can hold. The user can type the command, or pass options in plain words.

| Command | Use it for |
| --- | --- |
| `/devkit:bug-hunt [path]` | Bug sweep. Hunters work slices in parallel, then skeptics try to refute each finding. Options: `perSlice`, `skeptics`, `fix`, `focus`, `maxLines`. Writes `reports/bug-hunt/`. |
| `/devkit:fix-until-green [path]` | Fixes failing lint, typecheck, build or tests, in rounds, until everything passes. |
| `/devkit:style-sweep [path]` | Formats and restyles the code to the project's own conventions without changing behavior. |
| `/devkit:tune <target>` | Benchmarks the target, collects proposals from several angles, and keeps only measured wins. |
| `/devkit:develop "<task>"` | Plans a feature from three angles, implements it, reviews it from five angles, verifies the review with skeptics, then polishes. |

## Agents

Use these agents directly for smaller jobs:

- `devkit:bug-hunter` (read-only)
- `devkit:skeptic` (read-only; tries to disprove a claim)
- `devkit:reviewer` (read-only; reviews from one angle)
- `devkit:fixer`
- `devkit:stylist`
- `devkit:perf-tuner`
- `devkit:runner` (general helper for workflow steps)

Before reporting or fixing a claimed bug, have a skeptic check it.
