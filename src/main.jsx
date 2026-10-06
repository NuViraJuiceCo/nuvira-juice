import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import '@/styles/desktop-storefront.css'
import '@/styles/desktop-home.css'
import '@/styles/desktop-utility.css'
import { initializeNativeLiveUpdates } from '@/lib/nativeLiveUpdates'

initializeNativeLiveUpdates()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
