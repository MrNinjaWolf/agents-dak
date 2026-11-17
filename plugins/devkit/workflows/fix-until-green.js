export const meta = {
  name: 'fix-until-green',
  description: 'Run the project checks (format, lint, build, test) in any language, fix failures in parallel per file, and repeat until green or progress stalls',
  phases: [
    { title: 'Check', detail: 'run devkit and group failures by file' },
    { title: 'Fix', detail: 'one fixer per failing file, in parallel' },
    { title: 'Done', detail: 'final status' },
  ],
}

// Input: a path string, or { path, kind, maxRounds, lang }.
// kind: check (default) | lint | test | build | format-check
const opts = typeof args === 'string' ? { path: args } : (args ?? {})
const root = String(opts.path ?? '.').replace(/\/+$/, '') || '.'
const kind = String(opts.kind ?? 'check')
const maxRounds = Number(opts.maxRounds ?? 6)
const langFlag = opts.lang ? ` --lang ${opts.lang}` : ''

const STATUS = {
  type: 'object',
  required: ['ok', 'failures'],
  properties: {
    ok: { type: 'boolean' },
    failures: {
      type: 'array',
      items: {
        type: 'object',
        required: ['target', 'kind', 'summary'],
        properties: {
          target: { type: 'string', description: 'repo-relative file path, or the project dir when no single file is to blame' },
          kind: { type: 'string' },
          summary: { type: 'string' },
          details: { type: 'string', description: 'the relevant error lines, verbatim' },
        },
      },
    },
  },
}

const check = (round) =>
  agent(
    `Run \`devkit run ${kind} ${root}${langFlag}\` from the repo root and read its JSON output.
If it passes, return ok: true and no failures.
Otherwise return one failure per file that needs changing (a failing test belongs to the source file it exercises when the test is correct).
Copy the relevant error lines into details verbatim. Format-check failures go under the file the formatter named.
Don't change any files.`,
    { label: `check round ${round}`, schema: STATUS, effort: 'low' },
  )

const history = []
let status
let stalled = 0
for (let round = 1; round <= maxRounds; round++) {
  phase('Check')
  status = await check(round)
  if (!status) return { ok: false, error: 'checker agent failed', rounds: history }
  history.push({ round, failures: status.failures.length })
  log(`round ${round}: ${status.ok ? 'green' : `${status.failures.length} failing target(s)`}`)
  if (status.ok || status.failures.length === 0) break

  const prev = history.at(-2)?.failures
  stalled = prev !== undefined && status.failures.length >= prev ? stalled + 1 : 0
  if (stalled >= 2) { log('no progress for two rounds, stopping'); break }

  phase('Fix')
  const byTarget = new Map()
  for (const f of status.failures) byTarget.set(f.target, [...(byTarget.get(f.target) ?? []), f])
  await pipeline([...byTarget.entries()], ([target, list]) =>
    agent(
      `Make these ${kind} failures pass. Work only in ${target} (and its test file if the test itself is wrong).
${list.map((f) => `- [${f.kind}] ${f.summary}\n${(f.details ?? '').split('\n').map((l) => `    ${l}`).join('\n')}`).join('\n')}

Formatting failures: run the project's formatter on the file instead of editing by hand.
Never delete, skip or weaken a test to make it pass; fix the code under test. If the test is genuinely wrong, explain why in your report.`,
      { agentType: 'devkit:fixer', label: `fix r${round}: ${target}` },
    ),
  )
}

phase('Done')
return {
  ok: Boolean(status?.ok),
  rounds: history,
  remaining: status?.ok ? [] : (status?.failures ?? []).map((f) => `${f.target}: ${f.summary}`),
}
