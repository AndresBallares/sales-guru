export interface User {
  id: string
  email: string
  // True when this account has never accepted the current TERMS_VERSION
  // (a brand-new signup can't reach this — signup itself requires
  // acceptance — so in practice this only ever fires for an account that
  // predates the terms-acceptance feature, or a future terms-version
  // bump). ProtectedRoute gates on this to show the one-time full-page
  // TermsAcceptancePrompt before rendering anything else.
  needsTermsAcceptance: boolean
}

// One (value, label) pair — a single dropdown/display option. Every fixed
// option list in the app (industries, event venues, objectives, campaign
// statuses, ad CTAs, optimizer action types) is fetched from the backend
// via getOptions below rather than hand-copied here, so the frontend can
// never drift from app/schemas/options.py's OptionsResponse.
export interface Option {
  value: string
  label: string
}

export interface OptionsResponse {
  industries: Option[]
  objectives: Option[]
  campaignStatuses: Option[]
  ctas: Option[]
  actionTypes: Option[]
  eventVenues: Option[]
  voiceTraits: Option[]
  pricePositionings: Option[]
}

// Turns a fetched Option[] into a {value: label} lookup — used everywhere
// an Option list is looked up by value rather than just rendered as
// <option> elements (e.g. CampaignsSection.tsx, AdPreviewPage.tsx).
export function toLabelMap(options: Option[]): Record<string, string> {
  return Object.fromEntries(options.map((option) => [option.value, option.label]))
}

export interface Business {
  id: string
  name: string
  website: string | null
  industry: string | null
  location: string | null
  description: string | null
  // The uploaded logo's URL, or null if none has been uploaded yet — the
  // agent uses it to keep generated ads on-brand (brand DNA).
  logoUrl: string | null
}

export interface BusinessCreateInput {
  name: string
  website?: string
  industry: string
  location?: string
  description?: string
}

// Partial update — name, website, industry, location, and description are
// editable through this endpoint (app/schemas/business.py's
// BusinessUpdateRequest). A field's absence here (vs. an explicit value)
// decides whether it changes, matching the backend's model_dump
// exclude_unset semantics.
export interface BusinessUpdateInput {
  name?: string
  website?: string | null
  industry?: string
  location?: string | null
  description?: string | null
}

// "Brand DNA" (PRD.md §5 step 3.5) — one per business, feeds the
// Strategist/Creative Agent prompts as a dedicated "Brand voice" block
// whenever one exists. voiceTraits/pricePositioning are fixed lists —
// fetched via getOptions() (voiceTraits/pricePositionings), same pattern
// as every other fixed list in the app.
export interface BrandProfile {
  id: string
  businessId: string
  description: string
  idealCustomer: string
  voiceTraits: string[]
  pricePositioning: string
  brandPhrases: string | null
  avoidPhrases: string | null
  tagline: string | null
  competitors: string | null
  exampleCopy: string | null
  // Both feed the Creative Agent's objective-aware CTA structuring
  // (app/schemas/creative.py) — proofPoints grounds the description slot/
  // a trust line; offer is this business's own standing promotion,
  // distinct from a campaign's own strategy-level offer, and is what
  // actually gates the GET_OFFER CTA.
  proofPoints: string[]
  offer: string | null
  // Rides along from the parent business (app/api/brand_profile.py) so
  // the brand-profile view can show the whole identity together, without
  // a second business fetch.
  logoUrl: string | null
}

export interface BrandProfileCreateInput {
  description: string
  idealCustomer: string
  voiceTraits: string[]
  pricePositioning: string
  brandPhrases?: string
  avoidPhrases?: string
  tagline?: string
  competitors?: string
  exampleCopy?: string
  proofPoints?: string[]
  offer?: string
}

// Partial update — only fields explicitly provided change (same
// exclude_unset convention as BusinessUpdateInput).
export interface BrandProfileUpdateInput {
  description?: string
  idealCustomer?: string
  voiceTraits?: string[]
  pricePositioning?: string
  brandPhrases?: string | null
  avoidPhrases?: string | null
  tagline?: string | null
  competitors?: string | null
  exampleCopy?: string | null
  proofPoints?: string[]
  offer?: string | null
}

export interface Product {
  id: string
  description: string
  price: number | null
  margin: number | null
  features: string | null
  benefits: string | null
  url: string | null
  // The primary (first, ProductImage position 0) uploaded photo's URL, or
  // null if this product has no photos yet — used for campaign-list
  // thumbnails (CampaignsSection) without a separate images fetch.
  primaryImageUrl: string | null
}

export interface ProductCreateInput {
  description: string
  price?: number
  margin?: number
  features?: string
  benefits?: string
  url?: string
  // The campaign this product is being created for, if any — scopes
  // backend auto-attach to that one campaign (app/services/
  // campaign_readiness.py) instead of every empty draft in the business.
  campaignId?: string
}

// Partial update — a field's absence here (vs. an explicit null/value)
// decides whether it changes, matching the backend's model_dump
// exclude_unset semantics (app/schemas/product.py's ProductUpdateRequest).
// url is the one field a caller may want to explicitly clear, hence
// `| null` rather than reusing ProductCreateInput's `?: string`.
export interface ProductUpdateInput {
  description?: string
  price?: number
  margin?: number
  features?: string
  benefits?: string
  url?: string | null
}

export interface ProductImage {
  id: string
  url: string
  // Only ever set on the response to the upload call that produced this
  // image — never present on a later list/get (app/schemas/
  // product_image.py's ProductImageResponse docstring explains why).
  aspectRatioWarning?: string | null
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
  // The campaign this audience is being created for, if any — scopes
  // backend auto-attach to that one campaign (app/services/
  // campaign_readiness.py) instead of every empty draft in the business.
  campaignId?: string
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
  dailySpendFlag: string | null
  // True when a product is attached but lacks a destination URL this
  // campaign's SALES/TRAFFIC objective requires — computed by the
  // backend (app/api/campaign.py's _needs_destination_url), never
  // blocking the swap that produced it.
  needsDestinationUrl: boolean
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
  loc?: (string | number)[]
}

// FastAPI prefixes a request-body field's `loc` with "body" (confirmed
// against a real 422: `["body", "description"]`) — not a field name, so
// it's filtered out along with the other non-body-field wrapper segments
// FastAPI uses for query/path/header params. The last remaining string
// segment is the actual field the error is about; a list index (e.g. a
// validation error inside an array item) isn't itself a field name to
// label the message with, so only string segments count.
function fieldNameFromLoc(loc: (string | number)[] | undefined): string | null {
  if (!loc) {
    return null
  }
  const fieldSegments = loc.filter(
    (segment): segment is string =>
      typeof segment === 'string' &&
      segment !== 'body' &&
      segment !== 'query' &&
      segment !== 'path' &&
      segment !== 'header',
  )
  return fieldSegments.at(-1) ?? null
}

// "idealCustomer" -> "Ideal customer" — a generic camelCase/snake_case
// humanizer rather than a hand-maintained field->label table, so it stays
// correct for every field across the app (present and future) with no
// upkeep.
function humanizeFieldName(field: string): string {
  const spaced = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// One line per field (not one run-on "; "-joined sentence) so a response
// with several invalid fields — e.g. "Ideal customer: String should have
// at most 1000 characters" — actually says which fields, instead of
// repeating the same unlabeled message several times.
function extractErrorMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('detail' in body)) {
    return null
  }
  const detail = (body as { detail: unknown }).detail

  if (typeof detail === 'string') {
    return detail
  }
  if (Array.isArray(detail)) {
    const lines = (detail as ValidationErrorItem[])
      .filter((item): item is ValidationErrorItem & { msg: string } => Boolean(item.msg))
      .map((item) => {
        const field = fieldNameFromLoc(item.loc)
        return field ? `${humanizeFieldName(field)}: ${item.msg}` : item.msg
      })
    return lines.length > 0 ? lines.join('\n') : null
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

export function signup(
  email: string,
  password: string,
  termsAccepted: boolean,
): Promise<User> {
  return request<User>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, termsAccepted }),
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

export interface MessageResponse {
  message: string
}

export function forgotPassword(email: string): Promise<MessageResponse> {
  return request<MessageResponse>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function resetPassword(token: string, newPassword: string): Promise<MessageResponse> {
  return request<MessageResponse>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  })
}

export function getMe(): Promise<User> {
  return request<User>('/auth/me')
}

export function acceptTerms(): Promise<User> {
  return request<User>('/auth/accept-terms', { method: 'POST' })
}

export function getOptions(): Promise<OptionsResponse> {
  return request<OptionsResponse>('/options')
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

export function updateBusiness(
  businessId: string,
  input: BusinessUpdateInput,
): Promise<Business> {
  return request<Business>(`/businesses/${businessId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

// Soft-deletes the business (app/api/business.py's delete_business) —
// 409s (surfaced via ApiError.message) if any of its campaigns is still
// LIVE on Meta.
export function deleteBusiness(businessId: string): Promise<void> {
  return request<void>(`/businesses/${businessId}`, { method: 'DELETE' })
}

export function uploadBusinessLogo(businessId: string, file: File): Promise<Business> {
  const formData = new FormData()
  formData.append('file', file)
  return request<Business>(`/businesses/${businessId}/logo`, {
    method: 'POST',
    body: formData,
  })
}

export function createBrandProfile(
  businessId: string,
  input: BrandProfileCreateInput,
): Promise<BrandProfile> {
  return request<BrandProfile>(`/businesses/${businessId}/brand-profile`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getBrandProfile(businessId: string): Promise<BrandProfile> {
  return request<BrandProfile>(`/businesses/${businessId}/brand-profile`)
}

export function updateBrandProfile(
  businessId: string,
  input: BrandProfileUpdateInput,
): Promise<BrandProfile> {
  return request<BrandProfile>(`/businesses/${businessId}/brand-profile`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
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

export function updateProduct(
  businessId: string,
  productId: string,
  input: ProductUpdateInput,
): Promise<Product> {
  return request<Product>(`/businesses/${businessId}/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
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

// imageIds is the full new order (first = primary), not a single move —
// mirrors app/schemas/product_image.py's ReorderProductImagesRequest.
export function reorderProductImages(
  businessId: string,
  productId: string,
  imageIds: string[],
): Promise<ProductImage[]> {
  return request<ProductImage[]>(
    `/businesses/${businessId}/products/${productId}/images/order`,
    { method: 'PUT', body: JSON.stringify({ imageIds }) },
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

export interface CampaignUpdateInput {
  productId?: string
  audienceId?: string
}

export function updateCampaign(
  businessId: string,
  campaignId: string,
  input: CampaignUpdateInput,
): Promise<Campaign> {
  return request<Campaign>(`/businesses/${businessId}/campaigns/${campaignId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
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

export function deleteCampaign(businessId: string, campaignId: string): Promise<void> {
  return request<void>(`/businesses/${businessId}/campaigns/${campaignId}`, {
    method: 'DELETE',
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
  imageUrl: string | null
  status: CreativeStatus
  createdAt: string
  // Computed by the backend (app/services/creative.py's is_creative_stale)
  // — true once the product this was generated from has since been
  // edited or the campaign swapped onto a different one.
  isStale: boolean
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
  productImageId?: string,
): Promise<Creative> {
  return request<Creative>(
    `/businesses/${businessId}/campaigns/${campaignId}/creatives/${creativeId}/select`,
    {
      method: 'POST',
      ...(productImageId ? { body: JSON.stringify({ productImageId }) } : {}),
    },
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
  // True once the user explicitly dismissed the Pixel step for this
  // connection ("Skip for now") rather than never having gotten to it
  // yet — persisted server-side (app/api/meta.py's skip_pixel) so it
  // survives a remount instead of re-prompting every time.
  pixelSkipped: boolean
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

export function skipMetaPixel(businessId: string): Promise<MetaConnection> {
  return request<MetaConnection>(`/businesses/${businessId}/meta/pixel/skip`, {
    method: 'POST',
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
// Backend-computed from real conversion/spend volume, never an LLM
// self-assessment — see backend/app/services/optimizer.py's
// compute_test_confidence.
export type TestEvaluationConfidence = 'LOW' | 'DIRECTIONAL' | 'CONFIDENT'
export type HypothesisResult = 'SUPPORTED' | 'REJECTED' | 'INCONCLUSIVE'
export type TestEvaluationAction =
  | 'continue_testing'
  | 'test_new_creative'
  | 'investigate_offer_or_landing_page'
  | 'investigate_checkout_or_purchase_friction'
export type TestEvaluationStopReason =
  | 'MANUAL'
  | 'TEST_DURATION_ELAPSED'
  | 'TOTAL_SPEND_CIRCUIT_BREAKER'
  | 'CAC_CIRCUIT_BREAKER'

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
  stopReason: TestEvaluationStopReason
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
