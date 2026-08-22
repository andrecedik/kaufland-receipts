import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadReceipts } from '@/lib/receipts'

// Data must be loaded before the app renders -- every page reads the
// `receipts` array synchronously during render, so there's no in-app
// loading state to wire up as long as this resolves first.
loadReceipts().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
