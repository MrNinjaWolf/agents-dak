export const meta = {
  name: 'style-sweep',
  description: "Format and restyle a codebase in any language to its own conventions: run the formatters, then parallel stylists per slice, then verify nothing broke",
  phases: [
    { title: 'Conventions', detail: 'read config files and infer the house style' },
    { title: 'Format', detail: 'run the formatters' },
    { title: 'Restyle', detail: 'one stylist per slice for what tools miss' },
    { title: 'Verify', detail: 'checks must still pass' },
  ],
}

// Input: a path string, or { path, maxLines, guide }.
// guide: optional extra style rules, e.g. "prefer early returns; no abbreviations in names".
const opts = typeof args === 'string' ? { path: args } : (args ?? {})
const root = String(opts.path ?? '.').replace(/\/+$/, '') || '.'
const maxLines = Number(opts.maxLines ?? 800)
const rel = (f) => (root === '.' ? f : `${root}/${f}`)

phase('Conventions')
const guide = await agent(
  `Work out the house style for ${root}. Read the style configs that exist (.editorconfig, pyproject.toml/ruff.toml/setup.cfg,
eslint/prettier configs, rustfmt.toml, .clang-format, .rubocop.yml, CONTRIBUTING.md, CLAUDE.md) and sample a few representative source
files per language. Write a concise style guide (max 40 bullet lines, grouped by language) covering naming, error handling, imports,
comments, file/function size, and idioms the code already follows. Note where the code is inconsistent and which variant dominates.
${opts.guide ? `The user also wants: ${opts.guide}` : ''}
Return only the guide. Don't change files.`,
  { label: 'house style', effort: 'medium' },
)

phase('Format')
await agent(
  `Run \`devkit run format ${root}\`. If a formatter is missing, skip it and say which.
Then run \`git diff --stat\` and report which files the formatters touched. Don't make any manual edits.`,
  { label: 'run formatters', effort: 'low' },
)

const SLICES = {
  type: 'object',
  required: ['slices'],
  properties: { slices: { type: 'array', items: { type: 'object', required: ['name', 'files'], properties: { name: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } } } } },
}
const mapped = await agent(
  `Run \`devkit slices ${root} --max-lines ${maxLines}\` and return its slices unchanged, minus generated/vendored files.`,
  { label: 'map slices', schema: SLICES, effort: 'low' },
)
const slices = mapped?.slices ?? []

phase('Restyle')
const reports = await pipeline(slices, (s) =>
  agent(
    `Restyle only these files to the house style below. Behavior must not change.
${s.files.map((f) => `- ${rel(f)}`).join('\n')}

House style:
${guide ?? '(none found: follow the language standard style)'}`,
    { agentType: 'devkit:stylist', label: `style: ${s.name}` },
  ),
)

phase('Verify')
const verify = await agent(
  `Run \`devkit run check ${root}\`. If anything fails that the restyle could have caused (see \`git diff\`),
fix it with the smallest edit or revert that hunk. Report the final check status and any failures that were already there before.`,
  { agentType: 'devkit:fixer', label: 'verify checks' },
)

return { slices: slices.length, stylists_done: reports.filter(Boolean).length, verify }
