import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { readToken } from './api'
import { App } from './App'
import './styles.css'

readToken()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
