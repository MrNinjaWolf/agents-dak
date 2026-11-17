export const meta = {
  name: 'bug-hunt',
  description: 'Split a codebase into slices, hunt bugs in parallel, have skeptics try to refute every finding, optionally fix the survivors, and write reports/bug-hunt/result.json',
  phases: [
    { title: 'Map', detail: 'split the target into slices with devkit' },
    { title: 'Hunt', detail: 'one hunter per slice, up to perSlice findings each' },
    { title: 'Verify', detail: 'skeptics per finding, told to prove it wrong' },
    { title: 'Fix', detail: 'only with fix: true, one fixer per file with confirmed bugs' },
    { title: 'Report', detail: 'write result.json and report.md' },
  ],
}

// Input: a path string, or { path, perSlice, skeptics, maxLines, fix, focus, outDir }.
const opts = typeof args === 'string' ? { path: args } : (args ?? {})
const root = String(opts.path ?? '.').replace(/\/+$/, '') || '.'
const perSlice = Number(opts.perSlice ?? 3)
const skeptics = Math.max(1, Number(opts.skeptics ?? 2))
const maxLines = Number(opts.maxLines ?? 1500)
const outDir = String(opts.outDir ?? 'reports/bug-hunt')
const focus = opts.focus ? `\nExtra focus for this run: ${opts.focus}` : ''
const rel = (f) => (root === '.' ? f : `${root}/${f}`)

const SLICES = {
  type: 'object',
  required: ['slices'],
  properties: {
    slices: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'files'],
        properties: { name: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
}

const FINDINGS = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      maxItems: perSlice,
      items: {
        type: 'object',
        required: ['file', 'line', 'title', 'severity', 'evidence'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string' },
          evidence: { type: 'string' },
          fix_hint: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['verdict', 'reason'],
  properties: {
    verdict: { type: 'string', enum: ['survived', 'refuted', 'unverified'] },
    reason: { type: 'string' },
    reproduction: { type: 'string' },
  },
}

// ---- Phase 1: Map ---------------------------------------------------------
phase('Map')
const mapped = await agent(
  `Run \`devkit slices ${root} --max-lines ${maxLines}\` and return its slices.
Drop slices that contain only generated, vendored, minified, or fixture/data files. Keep test files only if they contain real logic.
Return the file paths exactly as the script printed them (relative to ${root}). Do not read the files.`,
  { agentType: 'devkit:runner', label: 'map slices', schema: SLICES, effort: 'low' },
)
const slices = (mapped?.slices ?? []).filter((s) => s.files.length > 0)
log(`${slices.length} slices under ${root}`)
if (slices.length === 0) return { root, error: 'no source files found' }

// ---- Phase 2: Hunt --------------------------------------------------------
phase('Hunt')
const hunted = await pipeline(slices, (s) =>
  agent(
    `Hunt for bugs in this slice of the repository (paths are relative to the repo root):
${s.files.map((f) => `- ${rel(f)}`).join('\n')}

Report at most ${perSlice} findings: only the strongest real defects, ranked by impact. Zero findings is fine.
Use repo-relative paths in "file".${focus}`,
    { agentType: 'devkit:bug-hunter', label: `hunt: ${s.name}`, schema: FINDINGS },
  ),
)

// Merge and de-duplicate (same file, lines within 2).
const findings = []
for (const r of hunted.filter(Boolean)) {
  for (const f of r.findings ?? []) {
    const dup = findings.find((g) => g.file === f.file && Math.abs(g.line - f.line) <= 2)
    if (!dup) findings.push({ id: findings.length + 1, ...f })
  }
}
log(`${findings.length} claimed findings`)
if (findings.length === 0) {
  phase('Report')
  return { root, slices: slices.length, claimed: 0, confirmed: [], note: 'hunters found nothing' }
}

// ---- Phase 3: Verify ------------------------------------------------------
phase('Verify')
const jobs = findings.flatMap((f) => Array.from({ length: skeptics }, (_, k) => ({ f, k })))
const verdicts = await pipeline(jobs, ({ f, k }) =>
  agent(
    `Claimed bug #${f.id} (${f.severity}): ${f.title}
Location: ${f.file}:${f.line}
Hunter's evidence:
${f.evidence}

Try to prove this claim wrong. If you cannot, try to reproduce it.`,
    { agentType: 'devkit:skeptic', label: `skeptic: #${f.id}-${k + 1} ${f.file}`, schema: VERDICT },
  ),
)

const judged = findings.map((f) => {
  const vs = jobs.map((j, i) => (j.f === f ? verdicts[i] : undefined)).filter((v) => v !== undefined)
  const count = (x) => vs.filter((v) => v?.verdict === x).length
  const survived = count('survived')
  const refuted = count('refuted')
  const status =
    survived > 0 && refuted === 0 ? 'confirmed'
      : survived > 0 && refuted > 0 ? 'disputed'
        : refuted > 0 ? 'refuted'
          : 'unverified'
  return { ...f, status, verdicts: vs.map((v) => v ?? { verdict: 'unverified', reason: 'agent failed' }) }
})
const confirmed = judged.filter((f) => f.status === 'confirmed')
log(`${confirmed.length} confirmed, ${judged.filter((f) => f.status === 'disputed').length} disputed, ${judged.filter((f) => f.status === 'refuted').length} refuted`)

// ---- Phase 4: Fix (opt-in) ------------------------------------------------
let fixes = []
if (opts.fix && confirmed.length > 0) {
  phase('Fix')
  const byFile = new Map()
  for (const f of confirmed) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f])
  fixes = await pipeline([...byFile.entries()], ([file, list]) =>
    agent(
      `Fix these confirmed bugs in ${file}. Only edit ${file} and its tests.
${list.map((f) => `- #${f.id} line ${f.line}: ${f.title}\n  evidence: ${f.evidence}\n  hint: ${f.fix_hint ?? 'n/a'}\n  skeptic reproduction: ${f.verdicts.find((v) => v.reproduction)?.reproduction ?? 'n/a'}`).join('\n')}`,
      { agentType: 'devkit:fixer', label: `fix: ${file}` },
    ),
  )
}

// ---- Phase 5: Report ------------------------------------------------------
phase('Report')
const result = {
  root,
  settings: { perSlice, skeptics, maxLines, fix: Boolean(opts.fix) },
  slices: slices.length,
  claimed: findings.length,
  confirmed: confirmed.map(({ verdicts, ...f }) => ({ ...f, reproduction: verdicts.find((v) => v.reproduction)?.reproduction })),
  disputed: judged.filter((f) => f.status === 'disputed'),
  refuted: judged.filter((f) => f.status === 'refuted').map(({ id, file, line, title, verdicts }) => ({ id, file, line, title, why: verdicts.map((v) => v.reason) })),
  unverified: judged.filter((f) => f.status === 'unverified').map(({ id, file, line, title }) => ({ id, file, line, title })),
  fixes: fixes.filter(Boolean),
}
await agent(
  `Write two files (create ${outDir}/ if needed):
1. ${outDir}/result.json containing exactly this JSON, pretty-printed:
${JSON.stringify(result)}
2. ${outDir}/report.md: a short human report. Title, one-line totals (slices, claimed, confirmed, disputed, refuted, unverified),
then a table of confirmed bugs ordered by severity (file:line, title, severity), then disputed ones with both sides in one line each,
then a "Fix log" section if fixes is non-empty. No other commentary.`,
  { agentType: 'devkit:runner', label: 'write report', effort: 'low' },
)

return {
  report: `${outDir}/report.md`,
  slices: slices.length,
  claimed: findings.length,
  confirmed: result.confirmed.map((f) => `${f.severity.toUpperCase()} ${f.file}:${f.line} ${f.title}`),
  disputed: result.disputed.length,
  refuted: result.refuted.length,
  unverified: result.unverified.length,
  fixed_files: opts.fix ? fixes.filter(Boolean).length : 'fix not requested',
}
