export const meta = {
  name: 'tune',
  description: 'Fine-tune a target for speed, memory or another metric: baseline benchmark, parallel optimization proposals from different angles, then apply them one at a time and keep only measured wins',
  phases: [
    { title: 'Baseline', detail: 'build a repeatable benchmark and measure' },
    { title: 'Propose', detail: 'one tuner per angle proposes changes, read-only' },
    { title: 'Select', detail: 'rank and pick the candidates worth trying' },
    { title: 'Apply', detail: 'sequentially apply, test, measure, keep or revert' },
  ],
}

// Input: a target string, or { target, metric, angles, maxTries }.
// target: a file, directory, function, endpoint or command to make faster/smaller.
const opts = typeof args === 'string' ? { target: args } : (args ?? {})
if (!opts.target) return { error: 'pass a target, e.g. /tune src/parser.py or { target: "go/ratelimit", metric: "allocations" }' }
const target = String(opts.target)
const metric = String(opts.metric ?? 'wall-clock time')
const maxTries = Number(opts.maxTries ?? 4)
const angles = opts.angles ?? [
  'algorithmic complexity and data structures',
  'memory allocation, copying and object churn',
  'I/O, caching, batching and redundant work',
  'concurrency and parallelism',
  'language/runtime-specific fast paths (built-ins, compiler hints, vectorized libraries)',
]

const BASELINE = {
  type: 'object',
  required: ['bench_command', 'median', 'unit'],
  properties: {
    bench_command: { type: 'string' },
    median: { type: 'number' },
    unit: { type: 'string' },
    spread_pct: { type: 'number' },
    hotspots: { type: 'array', items: { type: 'string' } },
  },
}
const PROPOSALS = {
  type: 'object',
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        required: ['title', 'files', 'change', 'expected_gain_pct', 'risk'],
        properties: {
          title: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          change: { type: 'string', description: 'precise description of the code change' },
          expected_gain_pct: { type: 'number' },
          risk: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
  },
}
const TRY = {
  type: 'object',
  required: ['kept', 'tests_pass', 'median'],
  properties: { kept: { type: 'boolean' }, tests_pass: { type: 'boolean' }, median: { type: 'number' }, note: { type: 'string' } },
}

phase('Baseline')
const base = await agent(
  `Target: ${target}. Metric: ${metric}.
Build a repeatable benchmark for the target. Prefer the project's own benchmark tooling; otherwise write a small harness under reports/tune/
(that directory is fine to create). The benchmark command must run from the repo root and print the measured value.
Run it at least 5 times, report the median and the spread, and profile once to list the top hotspots. Don't change source code.`,
  { agentType: 'devkit:perf-tuner', label: 'baseline', schema: BASELINE },
)
if (!base) return { error: 'baseline failed' }
log(`baseline: ${base.median} ${base.unit} (±${base.spread_pct ?? '?'}%) via ${base.bench_command}`)

phase('Propose')
const proposed = await pipeline(angles, (angle) =>
  agent(
    `Target: ${target}. Metric: ${metric}. Baseline ${base.median} ${base.unit} via \`${base.bench_command}\`.
Hotspots: ${(base.hotspots ?? []).join('; ') || 'unknown'}
Angle: ${angle}.
Propose up to 3 changes from this angle only. Read the code and you may experiment on copies under /tmp, but don't edit project files.
Every proposal must keep behavior identical.`,
    { agentType: 'devkit:perf-tuner', label: `propose: ${angle.split(' ')[0]}`, schema: PROPOSALS },
  ),
)
const all = proposed.filter(Boolean).flatMap((p) => p.proposals)
if (all.length === 0) return { baseline: base, note: 'no proposals' }

phase('Select')
const RANKED = { type: 'object', required: ['order'], properties: { order: { type: 'array', items: { type: 'integer' } } } }
const ranked = await agent(
  `Rank these optimization proposals for ${target} by expected gain per unit of risk, merge duplicates, and drop ones that conflict with a better one.
Return the indices to try, best first, at most ${maxTries}.
${all.map((p, i) => `[${i}] ${p.title} (+${p.expected_gain_pct}%, risk ${p.risk}) files: ${p.files.join(', ')}\n    ${p.change}`).join('\n')}`,
  { agentType: 'devkit:runner', label: 'rank proposals', schema: RANKED, effort: 'medium' },
)
const chosen = (ranked?.order ?? all.map((_, i) => i)).filter((i) => all[i]).slice(0, maxTries).map((i) => all[i])

// Apply sequentially: measurements interfere if run in parallel.
phase('Apply')
const tries = []
let current = base.median
for (const p of chosen) {
  const t = await agent(
    `Current ${metric}: ${current} ${base.unit} (benchmark: \`${base.bench_command}\`, noise ±${base.spread_pct ?? 5}%).
Try this optimization: ${p.title}
Files: ${p.files.join(', ')}
Change: ${p.change}

Before editing, copy each file to /tmp/tune-backup/ so you can restore it. Apply the change, run the tests
(\`devkit run test\` on the affected project) and the benchmark 5 times.
Keep the change only if tests pass and the median improves by more than the noise; otherwise restore the backups exactly.`,
    { agentType: 'devkit:perf-tuner', label: `apply: ${p.title}`, schema: TRY },
  )
  tries.push({ title: p.title, ...(t ?? { kept: false, note: 'agent failed' }) })
  if (t?.kept) current = t.median
  log(`${p.title}: ${t?.kept ? `kept -> ${t.median} ${base.unit}` : 'reverted'}`)
}

const gain = base.median ? Math.round(((base.median - current) / base.median) * 1000) / 10 : 0
return { target, metric, baseline: `${base.median} ${base.unit}`, final: `${current} ${base.unit}`, improvement_pct: gain, bench: base.bench_command, tries }
