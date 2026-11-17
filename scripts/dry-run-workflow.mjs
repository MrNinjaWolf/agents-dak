#!/usr/bin/env node
// Dry-run a Claude Code workflow script with fake agents: no model calls, no tokens.
// Checks the script parses, follows the runtime's rules, and that its control flow
// works end to end. Fake agents answer from their `schema` (or from fixtures).
//
// Usage:
//   node scripts/dry-run-workflow.mjs .claude/workflows/bug-hunt.js [--args '<json>'] [--fixtures f.json] [--items N] [--quiet]
//
// fixtures.json maps a substring of an agent's label to the value it returns, e.g.
//   { "map slices": { "slices": [{ "name": "s1", "files": ["a.py"] }] },
//     "skeptic": { "verdict": "survived", "reason": "reproduced" } }
// A fixture value that is an array is consumed in order, one entry per matching call.
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const file = argv.find((a) => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.match(/^--(args|fixtures|items)$/))
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined }
if (!file) { console.error('usage: dry-run-workflow.mjs <workflow.js> [--args json] [--fixtures file] [--items N] [--quiet]'); process.exit(2) }

const src = readFileSync(file, 'utf8')
const args = flag('args') !== undefined ? JSON.parse(flag('args')) : undefined
const fixtures = flag('fixtures') ? JSON.parse(readFileSync(flag('fixtures'), 'utf8')) : {}
const items = Number(flag('items') ?? 2)
const quiet = argv.includes('--quiet')
const problems = []

// --- static rules the real runtime enforces ---
if (!/^\s*export const meta\s*=/.test(src)) problems.push('`export const meta` must be the first statement')
if (/\bimport\s*\(/.test(src) || /^\s*import\s/m.test(src)) problems.push('scripts cannot import modules')
const metaMatch = src.match(/export const meta\s*=\s*(\{[\s\S]*?\n\})/)
let meta
try {
  meta = new Function(`"use strict"; return (${metaMatch[1]})`)()
  if (!meta.name || !meta.description) problems.push('meta needs name and description')
  if (/[^'"`\w](\.\.\.|\w+\()/.test(metaMatch[1].replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""'))) problems.push('meta must be a plain literal (no spreads or calls)')
} catch (e) { problems.push(`meta is not a plain object literal: ${e.message}`) }

// --- fake runtime ---
const calls = []
let currentPhase = null
const used = {}
const fake = (schema, depth = 0) => {
  if (!schema || depth > 6) return 'fake'
  if (schema.enum) return schema.enum[0]
  switch (schema.type) {
    case 'object': return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, v]) => [k, fake(v, depth + 1)]))
    case 'array': return Array.from({ length: Math.min(items, schema.maxItems ?? items) }, () => fake(schema.items, depth + 1))
    case 'integer': case 'number': return 1
    case 'boolean': return true
    default: return 'fake'
  }
}
const agent = async (prompt, o = {}) => {
  if (typeof prompt !== 'string' || !prompt.trim()) problems.push(`agent() called with an empty prompt (label ${o.label})`)
  const label = o.label ?? prompt.slice(0, 50)
  calls.push({ phase: currentPhase, label, agentType: o.agentType, schema: Boolean(o.schema) })
  const key = Object.keys(fixtures).find((k) => label.includes(k))
  if (key) {
    const v = fixtures[key]
    if (Array.isArray(v)) { used[key] = (used[key] ?? 0) + 1; return v[Math.min(used[key], v.length) - 1] }
    return v
  }
  return o.schema ? fake(o.schema) : `fake result for ${label}`
}
const pipeline = async (list, fn) => {
  if (list.length > 4096) throw new Error('pipeline() accepts at most 4096 items')
  return Promise.all(list.map((x, i) => Promise.resolve(fn(x, i)).catch((e) => { problems.push(`pipeline item failed: ${e.message}`); return null })))
}
const parallel = async (tasks) => Promise.all(tasks.map((t) => (typeof t === 'function' ? t() : t)))
const phase = (title) => {
  currentPhase = title
  if (meta?.phases && !meta.phases.some((p) => p.title === title)) problems.push(`phase('${title}') has no entry in meta.phases`)
}
const log = (m) => { if (!quiet) console.log(`  log: ${m}`) }

const body = src.replace(/^\s*export const meta\s*=/, 'const meta =')
const RealDate = Date
const guardedDate = new Proxy(RealDate, {
  construct: (t, a) => { if (a.length === 0) throw new Error('new Date() is not allowed in workflows'); return new t(...a) },
  get: (t, p) => (p === 'now' ? () => { throw new Error('Date.now() is not allowed in workflows') } : t[p]),
})
const guardedMath = Object.create(Math, { random: { value: () => { throw new Error('Math.random() is not allowed in workflows') } } })

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
let result
try {
  const run = new AsyncFunction('agent', 'pipeline', 'parallel', 'phase', 'log', 'args', 'Date', 'Math', body)
  result = await run(agent, pipeline, parallel, phase, log, args, guardedDate, guardedMath)
} catch (e) {
  problems.push(`runtime error: ${e.stack ?? e.message}`)
}

if (calls.length > 1000) problems.push(`spawned ${calls.length} agents; the runtime caps a run at 1000`)
console.log(`\n${meta?.name ?? file}: ${calls.length} agent call(s)`)
if (!quiet) {
  const byPhase = {}
  for (const c of calls) (byPhase[c.phase ?? '(no phase)'] ??= []).push(c)
  for (const [p, cs] of Object.entries(byPhase)) {
    console.log(`  [${p}] ${cs.length} agent(s)`)
    for (const c of cs.slice(0, 6)) console.log(`     - ${c.label}${c.agentType ? ` (${c.agentType})` : ''}${c.schema ? ' {schema}' : ''}`)
    if (cs.length > 6) console.log(`     ... ${cs.length - 6} more`)
  }
  console.log('  returned:', JSON.stringify(result, null, 2)?.split('\n').join('\n  '))
}
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length}):`)
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
console.log('OK')
