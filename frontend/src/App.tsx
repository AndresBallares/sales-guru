import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { GuestRoute } from './components/GuestRoute'
import { ProtectedRoute } from './components/ProtectedRoute'
import { SiteFooter } from './components/SiteFooter'
import { ThemeToggle } from './components/ThemeToggle'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { AdPreviewPage } from './pages/AdPreviewPage'
import { BusinessDetailPage } from './pages/BusinessDetailPage'
import { DashboardPage } from './pages/DashboardPage'
import { DataDeletionPage } from './pages/DataDeletionPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { LoginPage } from './pages/LoginPage'
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { SignupPage } from './pages/SignupPage'
import { TermsOfServicePage } from './pages/TermsOfServicePage'

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <div className="global-topbar">
            <ThemeToggle />
          </div>
          <Routes>
            <Route element={<GuestRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            </Route>
            {/* Not gated by GuestRoute — a reset link should still work even
                if this browser happens to already be logged in elsewhere. */}
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {/* Public, ungated — Meta's App Review reads these from a real
                public URL, and they need to be reachable whether or not the
                visitor (or Meta's own crawler) is logged in. */}
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsOfServicePage />} />
            <Route path="/data-deletion" element={<DataDeletionPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/businesses/:businessId" element={<BusinessDetailPage />} />
              <Route
                path="/businesses/:businessId/campaigns/:campaignId/ad"
                element={<AdPreviewPage />}
              />
            </Route>
          </Routes>
          <SiteFooter />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
