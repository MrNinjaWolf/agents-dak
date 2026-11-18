export const meta = {
  name: 'bet',
  description: 'Six-agent betting desk: two researchers dig into a sports topic, a research skeptic fact-checks them, the scout proposes bets, the skeptic tries to veto each one, the lead decides, the skeptic second-guesses the decisions, and the lead makes the final call',
  phases: [
    { title: 'Research', detail: 'agent 3 (researcher) and agent 5 (second-researcher) in parallel' },
    { title: 'Fact-check', detail: 'agent 6 (research-skeptic) checks both briefs' },
    { title: 'Scout', detail: 'agent 4 (bet-scout) proposes bets from agent 3 research' },
    { title: 'Veto', detail: 'agent 2 (skeptic) tries to veto each proposed bet' },
    { title: 'Decide', detail: 'agent 1 (lead) makes the first call' },
    { title: 'Challenge', detail: 'agent 2 (skeptic) second-guesses every decision' },
    { title: 'Final', detail: 'agent 1 (lead) answers the objections and makes the final call' },
    { title: 'Report', detail: 'agent 1 (lead) writes the report' },
  ],
}

// Input: a topic string, or { topic, maxBets, maxStake, books, outDir }.
const opts = typeof args === 'string' ? { topic: args } : (args ?? {})
const topic = String(opts.topic ?? '').trim()
if (!topic) return { error: 'give a topic, e.g. /betting-desk:bet "Lakers vs Celtics tonight"' }
const maxBets = Math.max(1, Number(opts.maxBets ?? 5))
const maxStake = Math.max(0.5, Number(opts.maxStake ?? 2))
const books = opts.books ? `\nOnly use prices from these sportsbooks: ${opts.books}.` : ''
const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'topic'
const outDir = String(opts.outDir ?? 'reports/betting-desk')
const reportPath = `${outDir}/${slug}.md`

// American odds -> implied probability (0..1).
const implied = (odds) => {
  const o = Number(odds)
  if (!Number.isFinite(o) || Math.abs(o) < 100) return null
  return o < 0 ? -o / (-o + 100) : 100 / (o + 100)
}
const pct = (p) => (p == null ? 'n/a' : `${(p * 100).toFixed(1)}%`)

const FACT = {
  type: 'object',
  required: ['claim', 'source', 'confidence'],
  properties: {
    claim: { type: 'string' },
    source: { type: 'string' },
    date: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
}
const BRIEF = {
  type: 'object',
  required: ['summary', 'facts', 'odds', 'unknowns'],
  properties: {
    summary: { type: 'string' },
    facts: { type: 'array', items: FACT },
    odds: {
      type: 'array',
      items: {
        type: 'object',
        required: ['event', 'market', 'selection', 'book', 'american'],
        properties: {
          event: { type: 'string' },
          market: { type: 'string' },
          selection: { type: 'string' },
          book: { type: 'string' },
          american: { type: 'integer' },
          as_of: { type: 'string' },
        },
      },
    },
    unknowns: { type: 'array', items: { type: 'string' } },
  },
}
const FACTCHECK = {
  type: 'object',
  required: ['checks', 'missed'],
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'verdict', 'reason'],
        properties: {
          claim: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'refuted', 'disputed', 'unverified'] },
          reason: { type: 'string' },
          correction: { type: 'string' },
        },
      },
    },
    missed: { type: 'array', items: { type: 'string' } },
  },
}
const PROPOSALS = {
  type: 'object',
  required: ['bets'],
  properties: {
    bets: {
      type: 'array',
      maxItems: maxBets,
      items: {
        type: 'object',
        required: ['event', 'market', 'selection', 'book', 'american', 'est_prob', 'confidence', 'reasons', 'risk'],
        properties: {
          event: { type: 'string' },
          market: { type: 'string' },
          selection: { type: 'string' },
          book: { type: 'string' },
          american: { type: 'integer' },
          est_prob: { type: 'number', description: 'estimated true win probability, 0 to 1' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reasons: { type: 'string' },
          risk: { type: 'string' },
          correlated_with: { type: 'string' },
        },
      },
    },
    note: { type: 'string' },
  },
}
const VETO = {
  type: 'object',
  required: ['verdict', 'reason'],
  properties: {
    verdict: { type: 'string', enum: ['veto', 'downgrade', 'pass'] },
    reason: { type: 'string' },
    acceptable_price: { type: 'integer', description: 'worst American odds at which the bet would still be acceptable, if any' },
  },
}
const DECISIONS = {
  type: 'object',
  required: ['decisions', 'summary'],
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'decision', 'stake_units', 'reason'],
        properties: {
          id: { type: 'integer' },
          decision: { type: 'string', enum: ['approve', 'reject'] },
          stake_units: { type: 'number' },
          min_price: { type: 'integer', description: 'worst American odds at which to still place it' },
          reason: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
}
const OBJECTIONS = {
  type: 'object',
  required: ['objections'],
  properties: {
    objections: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'objection', 'would_change_my_mind'],
        properties: {
          id: { type: 'integer' },
          objection: { type: 'string' },
          would_change_my_mind: { type: 'string' },
        },
      },
    },
  },
}

const show = (x) => JSON.stringify(x, null, 1)

// ---- Research: agents 3 and 5 --------------------------------------------
phase('Research')
const researchTask = `Research this sports betting topic: "${topic}".
Find everything relevant to the outcome and to the betting markets. Every fact needs a source and a date.${books}`
const [primary, second] = await parallel([
  () => agent(researchTask, { agentType: 'betting-desk:researcher', label: 'agent 3: research', schema: BRIEF }),
  () => agent(`${researchTask}
Work independently of any other researcher and favour different sources. Look hard for facts that cut against the obvious story.`,
  { agentType: 'betting-desk:second-researcher', label: 'agent 5: independent research', schema: BRIEF }),
])
if (!primary) return { topic, error: 'the primary researcher (agent 3) returned nothing' }
log(`agent 3: ${primary.facts?.length ?? 0} facts, ${primary.odds?.length ?? 0} prices; agent 5: ${second?.facts?.length ?? 0} facts`)

// ---- Fact-check: agent 6 --------------------------------------------------
phase('Fact-check')
const factcheck = (await agent(
  `Fact-check the research on "${topic}". Agent 3's brief:
${show(primary)}

Agent 5's independent brief:
${show(second ?? { note: 'agent 5 returned nothing' })}

Resolve every conflict between them and check the claims that matter most to the outcome (injuries, lineups, odds, key stats). List important facts both missed.`,
  { agentType: 'betting-desk:research-skeptic', label: 'agent 6: fact-check', schema: FACTCHECK },
)) ?? { checks: [], missed: [] }
const refuted = factcheck.checks.filter((c) => c.verdict === 'refuted').length
log(`agent 6: ${factcheck.checks.length} claims checked, ${refuted} refuted, ${factcheck.missed.length} missed facts added`)

// ---- Scout: agent 4 -------------------------------------------------------
phase('Scout')
const scouted = await agent(
  `Find the best bets on "${topic}" using agent 3's research below, corrected by agent 6's fact-check.
Propose at most ${maxBets} bets, best first. Proposing none is fine if nothing has an edge.${books}

Agent 3's research:
${show(primary)}

Agent 6's fact-check (drop refuted facts, treat disputed ones as unknown; use the corrections and missed facts):
${show(factcheck)}`,
  { agentType: 'betting-desk:bet-scout', label: 'agent 4: scout bets', schema: PROPOSALS },
)
const bets = (scouted?.bets ?? []).slice(0, maxBets).map((b, i) => {
  const imp = implied(b.american)
  return { id: i + 1, ...b, implied_prob: imp, edge: imp == null ? null : b.est_prob - imp }
})
log(`agent 4: ${bets.length} proposed bet(s)`)

const finish = async (result) => {
  phase('Report')
  await agent(
    `Write ${reportPath} (create ${outDir}/ if needed) as a short markdown report of the betting desk's run on "${topic}".
Sections: Final slate (table: bet, book, odds, stake units, minimum price, one-line reason), Passed and vetoed bets (one line each with the reason),
Key facts and fact-check (the few facts that drove decisions, and anything refuted), Open risks. End with a one-line reminder that this is analysis, not a guarantee, and to bet only where legal and only what you can afford to lose.
Data:
${show(result)}`,
    { agentType: 'betting-desk:lead', label: 'agent 1: write report', effort: 'low' },
  )
  return { report: reportPath, ...result }
}

if (bets.length === 0) {
  return finish({ topic, final: [], note: scouted?.note ?? 'the scout found no bet with an edge', research: primary.summary, factcheck })
}

// ---- Veto: agent 2 on each bet --------------------------------------------
phase('Veto')
const vetoes = await pipeline(bets, (b) =>
  agent(
    `Proposed bet #${b.id} on "${topic}": ${b.selection} (${b.market}, ${b.event}) at ${b.american > 0 ? '+' : ''}${b.american} on ${b.book}.
Implied probability ${pct(b.implied_prob)}; the scout estimates ${pct(b.est_prob)} (edge ${pct(b.edge)}), confidence ${b.confidence}.
Scout's reasons: ${b.reasons}
Scout's own stated risk: ${b.risk}${b.correlated_with ? `\nCorrelated with: ${b.correlated_with}` : ''}

Agent 5's independent research, to cross-check the scout:
${show(second ?? { note: 'agent 5 returned nothing' })}

Agent 6's fact-check:
${show(factcheck)}

Find every reason this bet won't work, then give your verdict.`,
    { agentType: 'betting-desk:skeptic', label: `agent 2: veto #${b.id} ${b.selection}`, schema: VETO },
  ),
)
const reviewed = bets.map((b, i) => ({ ...b, skeptic: vetoes[i] ?? { verdict: 'pass', reason: 'skeptic returned nothing; treat as unchecked' } }))
log(`agent 2: ${reviewed.filter((b) => b.skeptic.verdict === 'veto').length} vetoed, ${reviewed.filter((b) => b.skeptic.verdict === 'downgrade').length} downgraded`)

// ---- Decide: agent 1 ------------------------------------------------------
phase('Decide')
const leadBrief = `Topic: "${topic}". Stake cap: ${maxStake} units per bet.

Proposed bets with the skeptic's verdicts (implied_prob and edge are computed from the price):
${show(reviewed)}

Agent 3's research summary: ${primary.summary}
Agent 5's research summary: ${second?.summary ?? 'n/a'}
Agent 6's fact-check:
${show(factcheck)}`
const first = await agent(
  `${leadBrief}

Decide every bet: approve (with stake in units, at most ${maxStake}, and the worst price you'd still take) or reject. Overrule a veto only with a specific reason the objection is wrong.`,
  { agentType: 'betting-desk:lead', label: 'agent 1: first decision', schema: DECISIONS },
)
const firstDecisions = first?.decisions ?? reviewed.map((b) => ({ id: b.id, decision: 'reject', stake_units: 0, reason: 'lead returned nothing' }))

// ---- Challenge: agent 2 second-guesses the lead ---------------------------
phase('Challenge')
const challenge = await agent(
  `The lead has made these decisions on "${topic}":
${show(firstDecisions)}
Lead's summary: ${first?.summary ?? 'n/a'}

The bets they refer to:
${show(reviewed)}

Second-guess every decision: approvals that shouldn't be placed, stakes that are too big, minimum prices that are too generous, and rejections of bets that really did have value.
Give one objection per decision you disagree with, and what would change your mind. Return no objections only if you genuinely agree with all of them.`,
  { agentType: 'betting-desk:skeptic', label: 'agent 2: challenge decisions', schema: OBJECTIONS },
)
const objections = challenge?.objections ?? []
log(`agent 2: ${objections.length} objection(s) to the lead's decisions`)

// ---- Final: agent 1 -------------------------------------------------------
phase('Final')
const final = objections.length === 0
  ? first
  : await agent(
    `${leadBrief}

Your first decisions:
${show(firstDecisions)}

The skeptic's objections to them:
${show(objections)}

Make the final call on every bet. For each objection, either change the decision or say specifically why it is wrong. Stake cap is ${maxStake} units.`,
    { agentType: 'betting-desk:lead', label: 'agent 1: final decision', schema: DECISIONS },
  )
const finalDecisions = final?.decisions ?? firstDecisions

const slate = reviewed.map((b) => {
  const d = finalDecisions.find((x) => x.id === b.id) ?? { decision: 'reject', stake_units: 0, reason: 'no decision recorded' }
  const stake = d.decision === 'approve' ? Math.min(maxStake, Math.max(0, Number(d.stake_units) || 0)) : 0
  return {
    id: b.id,
    bet: `${b.selection} (${b.market}, ${b.event})`,
    book: b.book,
    american: b.american,
    implied: pct(b.implied_prob),
    estimated: pct(b.est_prob),
    edge: pct(b.edge),
    skeptic: `${b.skeptic.verdict}: ${b.skeptic.reason}`,
    objection: objections.find((o) => o.id === b.id)?.objection,
    decision: stake > 0 ? 'approve' : 'reject',
    stake_units: stake,
    min_price: d.min_price,
    reason: d.reason,
  }
})

return finish({
  topic,
  settings: { maxBets, maxStake, books: opts.books ?? 'any' },
  final: slate.filter((s) => s.decision === 'approve'),
  passed: slate.filter((s) => s.decision === 'reject'),
  lead_summary: final?.summary ?? first?.summary,
  research: { agent3: primary.summary, agent5: second?.summary },
  factcheck,
})
