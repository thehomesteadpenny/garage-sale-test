import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/sage-awning.css'
import './styles/app.css'
import { Store } from './pages/Store'
import { Order } from './pages/Order'
import { Seller } from './pages/Seller'

function Awning() {
  return (
    <>
      <header className="sa-awning awning-band">
        <a className="awning-link" href="/">
          <span className="sa-wordmark">
            <span className="sa-wordmark__our">My</span>
            <span className="sa-wordmark__name">Garage Sale</span>
          </span>
        </a>
      </header>
      <div className="sa-scallop" />
    </>
  )
}

function App() {
  const path = window.location.pathname
  const orderMatch = path.match(/^\/order\/([A-Za-z0-9_-]{20,})$/)
  let page
  if (orderMatch) page = <Order token={orderMatch[1]} />
  else if (path.startsWith('/seller')) page = <Seller />
  else page = <Store />
  return (
    <>
      <Awning />
      <main className="wrap">{page}</main>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
