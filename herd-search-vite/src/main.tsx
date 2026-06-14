import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App'
import TermsOfService from './pages/TermsOfService'
import AdminSupportPage from './pages/AdminSupportPage'
import AboutPage from './pages/AboutPage'
import PrivacyPolicy from './pages/PrivacyPolicy'

import InstallInstructionsPage from './pages/InstallInstructionsPage'

import { AuthProvider } from './contexts/AuthContext'

import { RequireAuth } from './components/RequireAuth'
import ScrollToTop from './components/ScrollToTop'

import UpgradePage from './pages/UpgradePage'
import AllUsersPage from './pages/AllUsersPage'
import FeedbackPage from './pages/FeedbackPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <AuthProvider>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/privacypolicy" element={<PrivacyPolicy />} />
          <Route path="/upgrade" element={<RequireAuth><UpgradePage /></RequireAuth>} />
          <Route path="/about" element={<RequireAuth><AboutPage /></RequireAuth>} />
          <Route path="/install" element={<RequireAuth><InstallInstructionsPage /></RequireAuth>} />
          <Route path="/admin/support" element={<RequireAuth><AdminSupportPage /></RequireAuth>} />
          <Route path="/all-users" element={<RequireAuth><AllUsersPage /></RequireAuth>} />
          <Route path="/feedback" element={<RequireAuth><FeedbackPage /></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
