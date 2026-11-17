export const meta = {
  name: 'develop',
  description: 'Build a feature or change in any language: plan from three angles, merge the best plan, implement with tests, review from five angles, have skeptics filter the review, fix what survives, and finish green',
  phases: [
    { title: 'Plan', detail: 'three planners: minimal, robust, idiomatic' },
    { title: 'Decide', detail: 'merge into one plan' },
    { title: 'Build', detail: 'implement with tests' },
    { title: 'Review', detail: 'correctness, tests, security, design, style' },
    { title: 'Verify', detail: 'a skeptic per review issue' },
    { title: 'Polish', detail: 'fix confirmed issues, then checks must pass' },
  ],
}

// Input: a task string, or { task, path, reviewAngles, includeLow }.
const opts = typeof args === 'string' ? { task: args } : (args ?? {})
if (!opts.task) return { error: 'pass a task, e.g. /develop "add a --json flag to the export command"' }
const task = String(opts.task)
const root = String(opts.path ?? '.')
const READ_ONLY = ['Edit', 'Write', 'NotebookEdit']

const PLAN = {
  type: 'object',
  required: ['summary', 'steps', 'files', 'tests'],
  properties: {
    summary: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    tests: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
}
const ISSUES = {
  type: 'object',
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        required: ['file', 'line', 'severity', 'problem'],
        properties: {
          file: { type: 'string' }, line: { type: 'integer' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          problem: { type: 'string' }, suggestion: { type: 'string' },
        },
      },
    },
  },
}
const VERDICT = {
  type: 'object',
  required: ['verdict', 'reason'],
  properties: { verdict: { type: 'string', enum: ['survived', 'refuted', 'unverified'] }, reason: { type: 'string' } },
}

phase('Plan')
const angles = [
  'minimal: the smallest change that fully solves the task, reusing existing code wherever possible',
  'robust: edge cases, error handling, backwards compatibility and test coverage first',
  'idiomatic: the way the existing codebase and the language community would structure it',
]
const plans = await pipeline(angles, (angle) =>
  agent(
    `Task: ${task}
Project root: ${root}. Run \`python3 scripts/toolchain.py detect ${root}\` to see languages and commands.
Plan the implementation from this angle: ${angle}.
Read the relevant code first. Name concrete files, functions and tests. Don't edit anything.`,
    { label: `plan: ${angle.split(':')[0]}`, schema: PLAN, disallowedTools: READ_ONLY },
  ),
)

phase('Decide')
const plan = await agent(
  `Task: ${task}
Three candidate plans (JSON):
${JSON.stringify(plans.filter(Boolean), null, 1)}
Pick the best one and fold in any strictly better ideas from the others (especially missing edge cases and tests).
Check claims against the code where they disagree. Return a single plan. Don't edit anything.`,
  { label: 'merge plans', schema: PLAN, disallowedTools: READ_ONLY },
)
if (!plan) return { error: 'planning failed' }
log(plan.summary)

phase('Build')
const built = await agent(
  `Implement this plan for the task "${task}".
${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
Files: ${plan.files.join(', ')}
Tests to add: ${plan.tests.join('; ')}
Risks to handle: ${(plan.risks ?? []).join('; ') || 'none listed'}

Match the surrounding code style. Write the tests with the project's existing framework. Run
\`python3 scripts/toolchain.py run check ${root}\` and get it passing. Don't commit. Report the files you changed.`,
  { label: 'implement' },
)

phase('Review')
const reviewAngles = opts.reviewAngles ?? ['correctness', 'tests', 'security', 'design', 'style']
const reviews = await pipeline(reviewAngles, (angle) =>
  agent(
    `Review the uncommitted change (\`git diff\` plus new untracked files from \`git status\`) made for the task "${task}".
Your angle: ${angle}. Report at most 5 issues, only real ones.`,
    { agentType: 'reviewer', label: `review: ${angle}`, schema: ISSUES },
  ),
)
const issues = reviews.flatMap((r, i) => (r?.issues ?? []).map((x) => ({ ...x, angle: reviewAngles[i] })))
  .filter((x) => x.severity !== 'low' || opts.includeLow)

phase('Verify')
const verdicts = await pipeline(issues, (x) =>
  agent(
    `A ${x.angle} reviewer claims: ${x.problem}
Location: ${x.file}:${x.line}. Suggested: ${x.suggestion ?? 'n/a'}
This is about the uncommitted change for "${task}". Try to prove the claim wrong.`,
    { agentType: 'skeptic', label: `skeptic: ${x.angle} ${x.file}:${x.line}`, schema: VERDICT },
  ),
)
const confirmed = issues.filter((_, i) => verdicts[i]?.verdict === 'survived')
log(`${issues.length} review issues, ${confirmed.length} survived the skeptics`)

phase('Polish')
const byFile = new Map()
for (const x of confirmed) byFile.set(x.file, [...(byFile.get(x.file) ?? []), x])
await pipeline([...byFile.entries()], ([file, list]) =>
  agent(
    `Address these confirmed review issues in ${file}:
${list.map((x) => `- [${x.angle}/${x.severity}] line ${x.line}: ${x.problem}${x.suggestion ? ` (suggestion: ${x.suggestion})` : ''}`).join('\n')}`,
    { agentType: 'fixer', label: `polish: ${file}` },
  ),
)
const final = await agent(
  `Run \`python3 scripts/toolchain.py run check ${root}\`. If it fails because of the change for "${task}", fix it (up to 3 attempts).
Return a short summary: files changed (\`git status --short\`), tests added, and the final check status.`,
  { agentType: 'fixer', label: 'final check' },
)

return { task, plan: plan.summary, build: built, review_issues: issues.length, fixed: confirmed.map((x) => `${x.file}:${x.line} ${x.problem}`), final }
