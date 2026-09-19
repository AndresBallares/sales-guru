import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  acceptTerms as apiAcceptTerms,
  getMe,
  login as apiLogin,
  logout as apiLogout,
  signup as apiSignup,
  type User,
} from '../lib/api'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, termsAccepted: boolean) => Promise<void>
  logout: () => Promise<void>
  acceptTerms: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setUser(await apiLogin(email, password))
  }, [])

  const signup = useCallback(
    async (email: string, password: string, termsAccepted: boolean) => {
      setUser(await apiSignup(email, password, termsAccepted))
    },
    [],
  )

  const logout = useCallback(async () => {
    await apiLogout()
    setUser(null)
  }, [])

  const acceptTerms = useCallback(async () => {
    setUser(await apiAcceptTerms())
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, acceptTerms }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
