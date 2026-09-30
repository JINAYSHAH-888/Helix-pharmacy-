import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../tokens/color-neutral.css'
import '../../tokens/color-good.css'
import '../../tokens/color-warn.css'
import '../../tokens/color-danger.css'
import '../../tokens/type.css'
import '../../tokens/semantic.css'
import './styles.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
