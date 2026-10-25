import type { StrategyContent, TargetAudience } from './api'
import { angleTag, conceptLabel } from './creativeAngle'

export interface GlanceItem {
  label: string
  value: string
}

// A labelled piece of the full strategy: a short paragraph, a list, or both.
export interface DetailField {
  label: string
  text?: string
  items?: string[]
}

export interface DetailSection {
  id: string
  title: string
  fields: DetailField[]
}

export interface AngleCard {
  title: string
  description: string
  tag: string
}

export interface StrategyView {
  summary: string
  glance: GlanceItem[]
  sections: DetailSection[]
  angles: AngleCard[]
}

const MAX_SENTENCE = 220
const MAX_ANGLE_TITLE = 60

function sentence(text: string | null | undefined): string {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return ''
  const first = /^[\s\S]*?[.!?](?=\s|$)/.exec(trimmed)?.[0] ?? trimmed
  let result = first
  if (result.length > MAX_SENTENCE) {
    result = `${result.slice(0, MAX_SENTENCE).replace(/\s+\S*$/, '')}…`
  }
  return /[.!?…]$/.test(result) ? result : `${result}.`
}

function titleCase(value: string): string {
  const spaced = value.replaceAll('_', ' ').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function money(value: number): string {
  return `$${value}`
}

function describeTargeting(audience: TargetAudience): string {
  return [
    audience.ageMin != null && audience.ageMax != null
      ? `${audience.ageMin}-${audience.ageMax}`
      : null,
    audience.genders?.join(', '),
    audience.location
      .map((loc) => [loc.city, loc.region].filter(Boolean).join(', '))
      .filter(Boolean)
      .join('; '),
    audience.interests.join(', '),
  ]
    .filter(Boolean)
    .join(' — ')
}

// Older strategies store an angle as one string ("Craftsmanship: hand-set stones").
// Split off a short leading name when there is one; otherwise number it rather than invent a name.
function plainAngle(raw: string, index: number): AngleCard {
  const separator = /\s[–—-]\s|:\s/.exec(raw)
  if (separator && separator.index > 0 && separator.index <= MAX_ANGLE_TITLE) {
    return {
      title: raw.slice(0, separator.index).trim(),
      description: raw.slice(separator.index + separator[0].length).trim(),
      tag: '',
    }
  }
  if (raw.length <= MAX_ANGLE_TITLE) return { title: raw, description: '', tag: '' }
  return { title: `Angle ${index + 1}`, description: raw, tag: '' }
}

function section(id: string, title: string, fields: (DetailField | null)[]): DetailSection | null {
  const kept = fields.filter((f): f is DetailField => f !== null)
  return kept.length > 0 ? { id, title, fields: kept } : null
}

function text(label: string, value: string | null | undefined): DetailField | null {
  return value?.trim() ? { label, text: value.trim() } : null
}

function list(label: string, items: string[]): DetailField | null {
  const kept = items.filter((item) => item.trim())
  return kept.length > 0 ? { label, items: kept } : null
}

function glanceItems(entries: [string, string | null | undefined][]): GlanceItem[] {
  return entries.flatMap(([label, value]) => {
    const trimmed = value?.trim()
    return trimmed ? [{ label, value: trimmed }] : []
  })
}

function indicators(criteria: { metric: string; guidance: string }[]): string[] {
  return criteria.map((c) => `${c.metric}: ${c.guidance}`)
}

// Reshapes a strategy of any plan type into what the strategy page shows. Every field the old
// write-up rendered is still reachable through `sections`; nothing is invented here.
export function buildStrategyView(strategy: StrategyContent): StrategyView {
  const unitEconomics = strategy.unitEconomics
    ? `Gross profit $${strategy.unitEconomics.grossProfit.toFixed(2)}, breakeven CAC $${strategy.unitEconomics.breakevenCac.toFixed(2)}, target CAC $${strategy.unitEconomics.targetCac.toFixed(2)}, breakeven ROAS ${strategy.unitEconomics.breakevenRoas.toFixed(2)}x`
    : null
  const copy = section('copy', 'Copy Strategy', [text('Copy direction', strategy.copyStrategy)])
  const offer = section('offer', 'Offer & Positioning', [
    text('Offer', strategy.offer),
    text('Positioning', strategy.positioning),
  ])

  if (strategy.planType === 'TEST_PLAN') {
    const challenger = strategy.audienceVariants.find((v) => !v.isBaseline)
    const audience = section(
      'audience',
      'Audience & Customer Persona',
      strategy.audienceVariants.map((variant) => ({
        label: `${variant.name}${variant.isBaseline ? ' (baseline)' : ''}`,
        text:
          [describeTargeting(variant.targeting) || 'Broad — no targeting constraints', variant.hypothesis]
            .filter(Boolean)
            .join('. ') || undefined,
      })),
    )
    const angleCards = strategy.creativeAngles.map(plainAngle)
    return {
      summary: [
        sentence(strategy.positioning),
        sentence(challenger?.hypothesis),
        sentence(strategy.copyStrategy),
      ]
        .filter(Boolean)
        .join(' '),
      glance: glanceItems([
        ['Objective', titleCase(strategy.objective)],
        ['Audience', strategy.audienceVariants.map((v) => v.name).join(' vs. ')],
        ['Offer', sentence(strategy.offer)],
        [
          'Testing plan',
          `${money(strategy.dailyBudget)}/day per variant · ${strategy.durationDays} days`,
        ],
      ]),
      sections: [
        audience,
        offer,
        section('creative', 'Creative Strategy', [
          list('Creative angles', strategy.creativeAngles),
        ]),
        copy,
        section('testing', 'Testing Plan & Metrics', [
          text(
            'Budget',
            `${money(strategy.dailyBudget)}/day per variant for ${strategy.durationDays} days (${money(strategy.totalBudget)} total across both variants)`,
          ),
          list(
            'Primary hypothesis',
            strategy.hypotheses.map(
              (h) =>
                `${h.statement} (measured by ${h.primaryMetric}, also tracking ${h.secondaryMetrics.join(', ')})`,
            ),
          ),
          list('Leading indicators (early signal)', indicators(strategy.successCriteria.leadingIndicators)),
          list(
            'Economic indicators (need more volume)',
            indicators(strategy.successCriteria.economicIndicators),
          ),
          text('Profitability', strategy.successCriteria.profitabilityNote),
          list(
            'Decision rules',
            strategy.decisionRules.map(
              (r) => `If ${r.condition} → ${r.action.replaceAll('_', ' ')}`,
            ),
          ),
          text('Unit economics', unitEconomics),
        ]),
      ].filter((s): s is DetailSection => s !== null),
      angles: angleCards,
    }
  }

  if (strategy.planType === 'CREATIVE_TEST_PLAN') {
    const { audienceConstraints: aud, creativePersona: persona } = strategy
    const event = strategy.optimizationEvent === 'ADD_TO_CART' ? 'add-to-cart' : 'purchase'
    const audienceLine = `Broad (Meta Advantage+), ${aud.country}, age ${aud.ageMin}+, ${aud.languages.join(', ')}`
    return {
      summary: [
        sentence(strategy.positioning),
        sentence(persona.problem ?? persona.description),
        sentence(strategy.copyStrategy),
      ]
        .filter(Boolean)
        .join(' '),
      glance: glanceItems([
        ['Objective', titleCase(strategy.objective)],
        ['Audience', `${persona.name} · ${aud.country}, ages ${aud.ageMin}+`],
        ['Offer', sentence(strategy.offer)],
        [
          'Testing plan',
          `${money(strategy.dailyBudget)}/day · ${strategy.durationDays} days · ${strategy.creativeAngles.length} creative angles`,
        ],
      ]),
      sections: [
        section('audience', 'Audience & Customer Persona', [
          text('Audience', audienceLine),
          text('Creative persona', `${persona.name} — ${persona.description}`),
          text('Problem', persona.problem),
          text('Desire', persona.desire),
        ]),
        offer,
        section('creative', 'Creative Strategy', [
          text(
            'Test approach',
            `One broad ad set runs ${strategy.creativeAngles.length} creative angles against each other to find which earns the cheapest ${event}.`,
          ),
          list(
            'Creative angles',
            strategy.creativeAngles.map(
              (a) => `${conceptLabel(a.concept)}${angleTag(a) ? ` (${angleTag(a)})` : ''} — ${a.description}`,
            ),
          ),
        ]),
        copy,
        section('testing', 'Testing Plan & Metrics', [
          text(
            'Budget',
            `${money(strategy.dailyBudget)}/day on one ad set for ${strategy.durationDays} days (${money(strategy.totalBudget)} total)`,
          ),
          text('Optimization event', titleCase(strategy.optimizationEvent)),
          list(
            'Primary hypothesis',
            strategy.hypotheses.map(
              (h) =>
                `${h.statement} (measured by ${h.primaryMetric}, also tracking ${h.secondaryMetrics.join(', ')})`,
            ),
          ),
          text('Unit economics', unitEconomics),
        ]),
      ].filter((s): s is DetailSection => s !== null),
      angles: strategy.creativeAngles.map((angle) => ({
        title: conceptLabel(angle.concept),
        description: angle.description,
        tag: angleTag(angle),
      })),
    }
  }

  const target = strategy.targetAudience
  const targeting = describeTargeting(target)
  return {
    summary: [
      sentence(strategy.positioning),
      sentence(target.problem ?? target.desire),
      sentence(strategy.copyStrategy),
    ]
      .filter(Boolean)
      .join(' '),
    glance: glanceItems([
      ['Objective', titleCase(strategy.objective)],
      ['Audience', targeting],
      ['Offer', sentence(strategy.offer)],
      ['Testing plan', `${money(strategy.budgetRecommendation.daily)}/day`],
    ]),
    sections: [
      section('audience', 'Audience & Customer Persona', [
        text('Target audience', targeting),
        text('Problem', target.problem),
        text('Desire', target.desire),
      ]),
      offer,
      section('creative', 'Creative Strategy', [list('Creative angles', strategy.creativeAngles)]),
      copy,
      section('testing', 'Testing Plan & Metrics', [
        text(
          'Budget',
          `${money(strategy.budgetRecommendation.daily)}/day — ${strategy.budgetRecommendation.rationale}`,
        ),
        list('Key learnings', strategy.keyLearnings),
        list('Recommended adjustments', strategy.recommendedAdjustments),
        text('Scaling trigger', strategy.scalingTrigger),
        text('Unit economics', unitEconomics),
      ]),
    ].filter((s): s is DetailSection => s !== null),
    angles: strategy.creativeAngles.map(plainAngle),
  }
}
