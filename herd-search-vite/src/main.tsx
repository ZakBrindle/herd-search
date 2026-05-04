import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App'
import TermsOfService from './pages/TermsOfService'
import AdminSupportPage from './pages/AdminSupportPage'
import AboutPage from './pages/AboutPage'

import InstallInstructionsPage from './pages/InstallInstructionsPage'

import { AuthProvider } from './contexts/AuthContext'

import { RequireAuth } from './components/RequireAuth'
import ScrollToTop from './components/ScrollToTop'

import UpgradePage from './pages/UpgradePage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <AuthProvider>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/terms" element={<RequireAuth><TermsOfService /></RequireAuth>} />
          <Route path="/upgrade" element={<RequireAuth><UpgradePage /></RequireAuth>} />
          <Route path="/about" element={<RequireAuth><AboutPage /></RequireAuth>} />
          <Route path="/install" element={<RequireAuth><InstallInstructionsPage /></RequireAuth>} />
          <Route path="/admin/support" element={<RequireAuth><AdminSupportPage /></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
