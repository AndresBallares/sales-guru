import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CreativeTestPlanContent, DataDrivenStrategyContent, StrategyContent } from '../lib/api'
import { StrategyOverview } from './StrategyOverview'

const dataDriven: DataDrivenStrategyContent = {
  planType: 'DATA_DRIVEN_STRATEGY',
  objective: 'SALES',
  targetAudience: {
    ageMin: 30,
    ageMax: 55,
    genders: null,
    location: [{ city: 'New York', region: 'New York' }],
    interests: ['fine jewelry'],
    problem: 'Hard to find quality pieces',
    desire: 'Own something unique',
  },
  offer: 'Custom emerald rings',
  positioning: 'Premium and personal',
  creativeAngles: ['Craftsmanship: hand-set stones', 'Luxury'],
  copyStrategy: 'Lead with the story behind each piece',
  budgetRecommendation: { daily: 25, rationale: 'Small test spend' },
  keyLearnings: ['Craftsmanship angle performed best'],
  recommendedAdjustments: ['Drop the price angle'],
  scalingTrigger: 'Increase budget once CAC stays under target',
  unitEconomics: null,
}

const creativeTest = {
  planType: 'CREATIVE_TEST_PLAN',
  objective: 'SALES',
  audienceConstraints: { country: 'US', ageMin: 18, languages: ['English'] },
  creativePersona: { name: 'Gift buyers', description: 'Women 30-55.', problem: null, desire: null },
  hypotheses: [],
  offer: 'Custom rings',
  positioning: 'Premium and personal',
  creativeAngles: [
    { avatar: 'gift_buyer', concept: 'gifting', pillar: 'emotion', description: 'A gift that lasts' },
  ],
  copyStrategy: 'Lead with the story',
  dailyBudget: 50,
  durationDays: 10,
  totalBudget: 500,
  optimizationEvent: 'PURCHASE',
  targetCostPerAddToCart: null,
  unitEconomics: null,
} as unknown as CreativeTestPlanContent

function renderOverview(
  strategy: StrategyContent = dataDriven,
  props: Partial<React.ComponentProps<typeof StrategyOverview>> = {},
) {
  return render(<StrategyOverview strategy={strategy} campaignName="Rings" {...props} />)
}

describe('StrategyOverview', () => {
  it('summarises the strategy from its real fields', () => {
    renderOverview()
    expect(screen.getByRole('heading', { name: 'Strategy at a glance' })).toBeInTheDocument()
    expect(screen.getByText('Your campaign strategy, summarized.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Premium and personal. Hard to find quality pieces. Lead with the story behind each piece.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText('Custom emerald rings.')).toBeInTheDocument()
    expect(screen.getByText('$25/day')).toBeInTheDocument()
  })

  it('keeps the full strategy collapsed until asked, then collapses it again', async () => {
    const user = userEvent.setup()
    renderOverview()
    const toggle = screen.getByRole('button', { name: 'View full strategy' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Small test spend', { exact: false })).not.toBeInTheDocument()

    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide full strategy' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    for (const title of [
      'Audience & Customer Persona',
      'Offer & Positioning',
      'Creative Strategy',
      'Copy Strategy',
      'Testing Plan & Metrics',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
    expect(screen.getByText(/Small test spend/)).toBeInTheDocument()
    expect(screen.getByText('Craftsmanship angle performed best')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hide full strategy' }))
    expect(screen.queryByText(/Small test spend/)).not.toBeInTheDocument()
  })

  it('omits fields the strategy does not have instead of rendering empty cards', async () => {
    const user = userEvent.setup()
    renderOverview({
      ...dataDriven,
      offer: '',
      targetAudience: { ...dataDriven.targetAudience, problem: null, desire: null },
      keyLearnings: [],
    })
    expect(screen.queryByText('Offer')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View full strategy' }))
    expect(screen.queryByText('Problem')).not.toBeInTheDocument()
    expect(screen.queryByText('Key learnings')).not.toBeInTheDocument()
  })

  it('shows creative angles as cards, splitting a named string angle', () => {
    renderOverview()
    expect(screen.getByRole('heading', { name: 'Creative angles to test' })).toBeInTheDocument()
    const cards = screen.getAllByRole('listitem')
    expect(within(cards[0]).getByRole('heading', { name: 'Craftsmanship' })).toBeInTheDocument()
    expect(within(cards[0]).getByText('hand-set stones')).toBeInTheDocument()
    expect(within(cards[1]).getByRole('heading', { name: 'Luxury' })).toBeInTheDocument()
  })

  it('numbers a long unnamed string angle rather than inventing a name', () => {
    const long = 'Show the ring on a hand in warm daylight so the stone looks alive and personal'
    renderOverview({ ...dataDriven, creativeAngles: [long] })
    expect(screen.getByRole('heading', { name: 'Angle 1' })).toBeInTheDocument()
    expect(screen.getByText(long)).toBeInTheDocument()
  })

  it('titles structured angles by concept and tags them with avatar and pillar', () => {
    renderOverview(creativeTest)
    expect(screen.getByRole('heading', { name: 'Gifting' })).toBeInTheDocument()
    expect(screen.getByText('Gift buyer · Emotion')).toBeInTheDocument()
    expect(screen.getByText('A gift that lasts')).toBeInTheDocument()
  })

  it('falls back gracefully when the strategy has no angles', () => {
    renderOverview({ ...dataDriven, creativeAngles: [] })
    expect(
      screen.getByText(/Creative directions will be developed during ad generation/),
    ).toBeInTheDocument()
  })

  it('calls the generate handler from the primary action', async () => {
    const user = userEvent.setup()
    const onGenerateAds = vi.fn<() => void>()
    renderOverview(dataDriven, { onGenerateAds })
    expect(screen.getByRole('heading', { name: 'Ready to create your ads?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Generate Ads' }))
    expect(onGenerateAds).toHaveBeenCalledTimes(1)
  })

  it('disables the action while generating so it cannot be submitted twice', () => {
    renderOverview(dataDriven, { onGenerateAds: vi.fn<() => void>(), generating: true })
    expect(screen.getByRole('button', { name: 'Generating ads…' })).toBeDisabled()
  })

  it('shows a failure and offers a retry without touching the strategy', async () => {
    const user = userEvent.setup()
    const onGenerateAds = vi.fn<() => void>()
    renderOverview(dataDriven, { onGenerateAds, error: 'Could not generate ads.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not generate ads.')
    expect(screen.getByRole('heading', { name: 'Strategy at a glance' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onGenerateAds).toHaveBeenCalledTimes(1)
  })

  it('hides the call to action when ads cannot be generated', () => {
    renderOverview()
    expect(screen.queryByRole('button', { name: 'Generate Ads' })).not.toBeInTheDocument()
  })
})
