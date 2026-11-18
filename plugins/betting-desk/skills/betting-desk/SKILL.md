---
name: betting-desk
description: How to research a sports matchup, team, player or market and find, vet and decide on bets with the betting-desk plugin's six agents. Use when the user asks for sports betting research, picks, value bets, or wants a bet second-guessed.
---

# Betting desk

Six agents work a topic the user gives (a game, team, player, league or market):

| # | Agent | Role |
| --- | --- | --- |
| 1 | `betting-desk:lead` | Makes every final decision: approve or reject, stake, worst acceptable price. |
| 2 | `betting-desk:skeptic` | Tries to veto every proposed bet, then second-guesses the lead's decisions. |
| 3 | `betting-desk:researcher` | Primary research: context, injuries, form, matchups, odds, news. |
| 4 | `betting-desk:bet-scout` | Finds bets with an edge in agent 3's research. |
| 5 | `betting-desk:second-researcher` | Independent research from different sources, used to cross-check. |
| 6 | `betting-desk:research-skeptic` | Fact-checks both researchers before anyone bets on their claims. |

## Workflow

`/betting-desk:bet "<topic>"` runs: Research (3 and 5 in parallel) → Fact-check (6) → Scout (4) → Veto (2 on each bet) → Decide (1) → Challenge (2) → Final (1) → Report.
It writes `reports/betting-desk/<topic>.md`.

Options, in plain words: `topic`, `maxBets` (5), `maxStake` units per bet (2), `books` (limit prices to these sportsbooks), `outDir`.

For a quick single opinion, use one agent directly, for example "Use betting-desk:skeptic to tear apart this bet: Chiefs -3 at -110".

Always present results as analysis, not certainty: bet only where it is legal and only what you can afford to lose.
