export interface User {
  id: string
  email: string
}

export interface Business {
  id: string
  name: string
  website: string | null
  industry: string | null
  location: string | null
  description: string | null
}

export interface BusinessCreateInput {
  name: string
  website?: string
  industry?: string
  location?: string
  description?: string
}

export interface Product {
  id: string
  description: string
  price: number | null
  margin: number | null
  features: string | null
  benefits: string | null
  url: string | null
}

export interface ProductCreateInput {
  description: string
  price?: number
  margin?: number
  features?: string
  benefits?: string
  url?: string
}

export interface ProductImage {
  id: string
  url: string
  createdAt: string
}

export interface Audience {
  id: string
  description: string
  ageMin: number | null
  ageMax: number | null
  location: string | null
  interests: string | null
  problem: string | null
  desire: string | null
}

export interface AudienceCreateInput {
  description: string
  ageMin?: number
  ageMax?: number
  location?: string
  interests?: string
  problem?: string
  desire?: string
}

export type Objective = 'SALES' | 'LEADS' | 'TRAFFIC' | 'MESSAGES' | 'AWARENESS'

export interface Campaign {
  id: string
  name: string | null
  objective: Objective
  status: string
  productId: string | null
  audienceId: string | null
  metaCampaignId: string | null
  eventVenueKey: string | null
  startDate: string | null
  endDate: string | null
  pausedReason: string | null
}

export interface CampaignCreateInput {
  objective: Objective
  name?: string
  productId?: string
  audienceId?: string
  eventVenueKey?: string
  startDate?: string
  endDate?: string
}

// Mirrors the backend's curated table (app/services/event_venues.py) —
// same "small, fixed, hand-curated set" reasoning already used for the
// Objective union above: no endpoint needed for a list this small and
// this static.
export interface EventVenueOption {
  key: string
  label: string
}

export const EVENT_VENUES: EventVenueOption[] = [
  { key: 'jck_las_vegas', label: 'JCK Las Vegas — Las Vegas Convention Center, NV' },
  { key: 'couture_las_vegas', label: 'Couture — Wynn Las Vegas, NV' },
  {
    key: 'agta_gemfair_tucson',
    label: 'AGTA GemFair Tucson — Tucson Convention Center, AZ',
  },
  { key: 'ja_new_york', label: 'JA New York — Javits Center, NY' },
]

const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface ValidationErrorItem {
  msg?: string
}

function extractErrorMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('detail' in body)) {
    return null
  }
  const detail = (body as { detail: unknown }).detail

  if (typeof detail === 'string') {
    return detail
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item: ValidationErrorItem) => item.msg)
      .filter((msg): msg is string => Boolean(msg))
      .join('; ')
  }
  return null
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // A FormData body (file upload) needs the browser to set its own
  // multipart Content-Type with the boundary — forcing application/json
  // here would break it.
  const isFormData = options.body instanceof FormData
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  })

  if (!response.ok) {
    let message = response.statusText
    try {
      const body: unknown = await response.json()
      message = extractErrorMessage(body) ?? message
    } catch {
      // No JSON body to read a message from — fall back to statusText.
    }
    throw new ApiError(response.status, message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export function signup(email: string, password: string): Promise<User> {
  return request<User>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function login(email: string, password: string): Promise<User> {
  return request<User>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function logout(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' })
}

export function getMe(): Promise<User> {
  return request<User>('/auth/me')
}

export function createBusiness(input: BusinessCreateInput): Promise<Business> {
  return request<Business>('/businesses', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listBusinesses(): Promise<Business[]> {
  return request<Business[]>('/businesses')
}

export function getBusiness(businessId: string): Promise<Business> {
  return request<Business>(`/businesses/${businessId}`)
}

export function createProduct(
  businessId: string,
  input: ProductCreateInput,
): Promise<Product> {
  return request<Product>(`/businesses/${businessId}/products`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listProducts(businessId: string): Promise<Product[]> {
  return request<Product[]>(`/businesses/${businessId}/products`)
}

export function uploadProductImage(
  businessId: string,
  productId: string,
  file: File,
): Promise<ProductImage> {
  const formData = new FormData()
  formData.append('file', file)
  return request<ProductImage>(
    `/businesses/${businessId}/products/${productId}/images`,
    { method: 'POST', body: formData },
  )
}

export function listProductImages(
  businessId: string,
  productId: string,
): Promise<ProductImage[]> {
  return request<ProductImage[]>(
    `/businesses/${businessId}/products/${productId}/images`,
  )
}

export function deleteProductImage(
  businessId: string,
  productId: string,
  imageId: string,
): Promise<void> {
  return request<void>(
    `/businesses/${businessId}/products/${productId}/images/${imageId}`,
    { method: 'DELETE' },
  )
}

export function createAudience(
  businessId: string,
  input: AudienceCreateInput,
): Promise<Audience> {
  return request<Audience>(`/businesses/${businessId}/audiences`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listAudiences(businessId: string): Promise<Audience[]> {
  return request<Audience[]>(`/businesses/${businessId}/audiences`)
}

export function createCampaign(
  businessId: string,
  input: CampaignCreateInput,
): Promise<Campaign> {
  return request<Campaign>(`/businesses/${businessId}/campaigns`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listCampaigns(businessId: string): Promise<Campaign[]> {
  return request<Campaign[]>(`/businesses/${businessId}/campaigns`)
}

export function approveCampaign(businessId: string, campaignId: string): Promise<Campaign> {
  return request<Campaign>(`/businesses/${businessId}/campaigns/${campaignId}/approve`, {
    method: 'POST',
  })
}

export function publishCampaign(businessId: string, campaignId: string): Promise<Campaign> {
  return request<Campaign>(`/businesses/${businessId}/campaigns/${campaignId}/publish`, {
    method: 'POST',
  })
}

export function pauseCampaign(businessId: string, campaignId: string): Promise<Campaign> {
  return request<Campaign>(`/businesses/${businessId}/campaigns/${campaignId}/pause`, {
    method: 'POST',
  })
}

export interface TargetLocation {
  city: string | null
  region: string | null
}

export interface TargetAudience {
  ageMin: number | null
  ageMax: number | null
  genders: string[] | null
  location: TargetLocation[]
  interests: string[]
  problem: string | null
  desire: string | null
}

export interface BudgetRecommendation {
  daily: number
  rationale: string
}

export interface UnitEconomics {
  grossProfit: number
  breakevenCac: number
  targetCac: number
  breakevenRoas: number
}

// --- TEST_PLAN: a structured advertising experiment (confirmed with the
// user 2026-08-31), not just two recommended audiences. Always compares a
// fixed broad/automated baseline (Variant A) against one specific,
// hypothesis-driven audience (Variant B).

export type AudienceVariantType = 'broad_automated' | 'hypothesis_driven'

export interface AudienceVariant {
  id: 'broad_baseline' | 'hypothesis_audience'
  name: string
  type: AudienceVariantType
  isBaseline: boolean
  hypothesis: string
  targeting: TargetAudience
}

export interface TestHypothesis {
  id: string
  statement: string
  baselineVariant: 'broad_baseline'
  testVariant: 'hypothesis_audience'
  primaryMetric: string
  secondaryMetrics: string[]
}

// Every field is null until real Meta data comes in — null means
// "unavailable or not applicable," never zero (confirmed with the user
// 2026-08-31).
export interface NormalizedMetrics {
  impressions: number | null
  reach: number | null
  spend: number | null
  cpm: number | null
  clicks: number | null
  ctr: number | null
  cpc: number | null
  landingPageViews: number | null
  addToCart: number | null
  addToCartRate: number | null
  conversions: number | null
  conversionRate: number | null
  cac: number | null
  purchaseValue: number | null
  roas: number | null
}

export interface BenchmarkContextEntry {
  low: number
  median: number
  high: number
  source: string
  asOf: string
  direction: 'higher_is_better' | 'lower_is_better'
}

// Industry-wide expectations for a cold-start campaign — not this
// business's actual performance (confirmed with the user 2026-08-31).
export interface BenchmarkContext {
  platform: 'meta'
  industry: 'jewelry'
  country: 'US'
  ctr: BenchmarkContextEntry
  cpm: BenchmarkContextEntry
  cvr: BenchmarkContextEntry
  cac: BenchmarkContextEntry
}

// benchmark (industry-wide) and businessTarget (this specific business's
// own economics) are deliberately two separate numbers, never blended
// into one (confirmed with the user 2026-09-01) — a $2,000 product at 50%
// margin needing "CAC below $100" has nothing to do with what the broader
// jewelry industry typically sees.
export interface SuccessCriterion {
  metric: string
  benchmark: BenchmarkContextEntry | null
  businessTarget: number | null
  direction: 'higher_is_better' | 'lower_is_better'
  guidance: string
}

export interface SuccessCriteria {
  leadingIndicators: SuccessCriterion[]
  economicIndicators: SuccessCriterion[]
  profitabilityNote: string
}

export interface DecisionRule {
  condition: string
  action: string
}

export interface DataSourceTag {
  businessFacts: string[]
  historicalMetaData: string[]
  industryBenchmarks: string[]
  aiGeneratedHypotheses: string[]
}

// A business with no meaningful advertising history yet. See
// DATA_DRIVEN_STRATEGY below for the alternative, generated instead once
// real performance data exists.
export interface TestPlanContent {
  planType: 'TEST_PLAN'
  objective: Objective
  audienceVariants: AudienceVariant[]
  hypotheses: TestHypothesis[]
  offer: string
  positioning: string
  creativeAngles: string[]
  copyStrategy: string
  dailyBudget: number
  durationDays: number
  totalBudget: number
  successCriteria: SuccessCriteria
  decisionRules: DecisionRule[]
  baselineMetrics: NormalizedMetrics
  benchmarkContext: BenchmarkContext
  dataSource: DataSourceTag
  unitEconomics: UnitEconomics | null
}

// A business with real historical performance data — a full strategy plus
// forward-looking guidance grounded in what already worked.
export interface DataDrivenStrategyContent {
  planType: 'DATA_DRIVEN_STRATEGY'
  objective: Objective
  targetAudience: TargetAudience
  offer: string
  positioning: string
  creativeAngles: string[]
  copyStrategy: string
  budgetRecommendation: BudgetRecommendation
  keyLearnings: string[]
  recommendedAdjustments: string[]
  scalingTrigger: string
  unitEconomics: UnitEconomics | null
}

export type StrategyContent = TestPlanContent | DataDrivenStrategyContent

export interface Strategy {
  id: string
  campaignId: string
  content: StrategyContent
  createdAt: string
}

// hasPriorAdvertisingExperience answers the one-time "has this business
// run ad campaigns before?" question — only needed the first time a
// business generates a strategy and only when Meta has no real ad-account
// history either; omitting it when the backend doesn't need it is fine.
// A 428 response (ApiError with status 428) means the backend does need
// it and this call should be retried with an answer.
export function createStrategy(
  businessId: string,
  campaignId: string,
  hasPriorAdvertisingExperience?: boolean,
): Promise<Strategy> {
  return request<Strategy>(`/businesses/${businessId}/campaigns/${campaignId}/strategy`, {
    method: 'POST',
    body:
      hasPriorAdvertisingExperience === undefined
        ? undefined
        : JSON.stringify({ hasPriorAdvertisingExperience }),
  })
}

export function getStrategy(businessId: string, campaignId: string): Promise<Strategy> {
  return request<Strategy>(`/businesses/${businessId}/campaigns/${campaignId}/strategy`)
}

export type Cta =
  | 'SHOP_NOW'
  | 'LEARN_MORE'
  | 'SIGN_UP'
  | 'SUBSCRIBE'
  | 'CONTACT_US'
  | 'MESSAGE_PAGE'
  | 'GET_OFFER'
  | 'DOWNLOAD'
  | 'BOOK_NOW'

export type CreativeStatus = 'GENERATED' | 'SELECTED' | 'REJECTED'

export interface Creative {
  id: string
  campaignId: string
  adId: string | null
  headline: string
  bodyText: string
  description: string
  cta: Cta
  creativeAngle: string | null
  imagePrompt: string | null
  videoPrompt: string | null
  status: CreativeStatus
  createdAt: string
}

export function createCreatives(businessId: string, campaignId: string): Promise<Creative[]> {
  return request<Creative[]>(`/businesses/${businessId}/campaigns/${campaignId}/creatives`, {
    method: 'POST',
  })
}

export function listCreatives(businessId: string, campaignId: string): Promise<Creative[]> {
  return request<Creative[]>(`/businesses/${businessId}/campaigns/${campaignId}/creatives`)
}

export function selectCreative(
  businessId: string,
  campaignId: string,
  creativeId: string,
): Promise<Creative> {
  return request<Creative>(
    `/businesses/${businessId}/campaigns/${campaignId}/creatives/${creativeId}/select`,
    { method: 'POST' },
  )
}

export interface MetaConnectResponse {
  authorizationUrl: string
}

export interface MetaAdAccount {
  id: string
  name: string
}

export interface MetaPage {
  id: string
  name: string
}

export interface MetaPixel {
  id: string
  name: string
}

export interface MetaConnection {
  id: string
  businessId: string
  metaUserId: string
  adAccountId: string | null
  pageId: string | null
  pixelId: string | null
  tokenExpiresAt: string
  createdAt: string
}

export function connectMeta(businessId: string): Promise<MetaConnectResponse> {
  return request<MetaConnectResponse>(`/businesses/${businessId}/meta/connect`)
}

export function getMetaConnection(businessId: string): Promise<MetaConnection> {
  return request<MetaConnection>(`/businesses/${businessId}/meta`)
}

export function listMetaAdAccounts(businessId: string): Promise<MetaAdAccount[]> {
  return request<MetaAdAccount[]>(`/businesses/${businessId}/meta/ad-accounts`)
}

export function listMetaPages(businessId: string): Promise<MetaPage[]> {
  return request<MetaPage[]>(`/businesses/${businessId}/meta/pages`)
}

export function listMetaPixels(businessId: string): Promise<MetaPixel[]> {
  return request<MetaPixel[]>(`/businesses/${businessId}/meta/pixels`)
}

export interface MetaFinalizeInput {
  adAccountId: string
  pageId: string
}

export function finalizeMetaConnection(
  businessId: string,
  input: MetaFinalizeInput,
): Promise<MetaConnection> {
  return request<MetaConnection>(`/businesses/${businessId}/meta/finalize`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function setMetaPixel(
  businessId: string,
  pixelId: string,
): Promise<MetaConnection> {
  return request<MetaConnection>(`/businesses/${businessId}/meta/pixel`, {
    method: 'POST',
    body: JSON.stringify({ pixelId }),
  })
}

export function disconnectMeta(businessId: string): Promise<void> {
  return request<void>(`/businesses/${businessId}/meta`, { method: 'DELETE' })
}

// Every field from reach onward is the "Phase B" extended metric set
// (confirmed 2026-09-01) — null means unavailable/not applicable, never
// zero (see the backend's fetch_campaign_insights for exactly when each
// is populated).
export interface Metric {
  id: string
  campaignId: string
  adSetId: string | null
  impressions: number
  clicks: number
  spend: number
  conversions: number
  reach: number | null
  cpm: number | null
  ctr: number | null
  cpc: number | null
  landingPageViews: number | null
  addToCart: number | null
  addToCartRate: number | null
  conversionRate: number | null
  cac: number | null
  purchaseValue: number | null
  roas: number | null
  fetchedAt: string
}

export function refreshMetrics(businessId: string, campaignId: string): Promise<Metric> {
  return request<Metric>(
    `/businesses/${businessId}/campaigns/${campaignId}/metrics/refresh`,
    { method: 'POST' },
  )
}

export function listMetrics(businessId: string, campaignId: string): Promise<Metric[]> {
  return request<Metric[]>(`/businesses/${businessId}/campaigns/${campaignId}/metrics`)
}

export type ActionType = 'PAUSE_AD' | 'INCREASE_BUDGET' | 'DECREASE_BUDGET'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type RecommendationStatus = 'PENDING' | 'APPLIED' | 'REJECTED' | 'SUPERSEDED'

export interface Recommendation {
  id: string
  campaignId: string
  actionType: ActionType
  targetAdId: string | null
  currentBudget: number | null
  suggestedBudget: number | null
  reasoning: string
  confidence: number
  risk: RiskLevel
  requiresApproval: boolean
  status: RecommendationStatus
  createdAt: string
}

export function createRecommendation(
  businessId: string,
  campaignId: string,
): Promise<Recommendation> {
  return request<Recommendation>(
    `/businesses/${businessId}/campaigns/${campaignId}/optimize`,
    { method: 'POST' },
  )
}

export function listRecommendations(
  businessId: string,
  campaignId: string,
): Promise<Recommendation[]> {
  return request<Recommendation[]>(
    `/businesses/${businessId}/campaigns/${campaignId}/optimize`,
  )
}

export function approveRecommendation(
  businessId: string,
  campaignId: string,
  recommendationId: string,
): Promise<Recommendation> {
  return request<Recommendation>(
    `/businesses/${businessId}/campaigns/${campaignId}/optimize/${recommendationId}/approve`,
    { method: 'POST' },
  )
}

export function rejectRecommendation(
  businessId: string,
  campaignId: string,
  recommendationId: string,
): Promise<Recommendation> {
  return request<Recommendation>(
    `/businesses/${businessId}/campaigns/${campaignId}/optimize/${recommendationId}/reject`,
    { method: 'POST' },
  )
}

// --- TEST_PLAN Optimizer ("Phase B", confirmed 2026-09-01) ------------------
//
// Distinct from Recommendation above, which applies regardless of plan
// type — this evaluates a TEST_PLAN's hypothesis against real Metric
// history. winningVariant/hypothesisResult are always null/'INCONCLUSIVE'
// today: real per-variant Meta data doesn't exist until multi-adset
// publishing ("Phase C") is built, so no comparison is possible yet.

export type TestEvaluationStatus = 'SUFFICIENT_DATA' | 'INSUFFICIENT_DATA'
export type TestEvaluationConfidence = 'LOW' | 'MEDIUM' | 'HIGH'
export type HypothesisResult = 'SUPPORTED' | 'REJECTED' | 'INCONCLUSIVE'
export type TestEvaluationAction =
  | 'continue_testing'
  | 'test_new_creative'
  | 'investigate_offer_or_landing_page'
  | 'investigate_checkout_or_purchase_friction'

export interface TestEvaluation {
  id: string
  campaignId: string
  status: TestEvaluationStatus
  winningVariant: 'broad_baseline' | 'hypothesis_audience' | null
  confidence: TestEvaluationConfidence
  hypothesisResult: HypothesisResult
  keyFindings: string[]
  recommendedAction: TestEvaluationAction
  reasoning: string
  createdAt: string
}

export function createTestEvaluation(
  businessId: string,
  campaignId: string,
): Promise<TestEvaluation> {
  return request<TestEvaluation>(
    `/businesses/${businessId}/campaigns/${campaignId}/test-evaluation`,
    { method: 'POST' },
  )
}

export function listTestEvaluations(
  businessId: string,
  campaignId: string,
): Promise<TestEvaluation[]> {
  return request<TestEvaluation[]>(
    `/businesses/${businessId}/campaigns/${campaignId}/test-evaluation`,
  )
}
