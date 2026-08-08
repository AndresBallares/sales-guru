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
  objective: Objective
  status: string
  productId: string | null
  audienceId: string | null
  metaCampaignId: string | null
}

export interface CampaignCreateInput {
  objective: Objective
  productId?: string
  audienceId?: string
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
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
