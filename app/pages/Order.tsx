import { useEffect, useState } from 'react'
import { api, money } from '../lib'

type OrderView = { firstName: string; totalCents: number; items: { title: string; price_cents: number }[] }

export function Order({ token }: { token: string }) {
  const [order, setOrder] = useState<OrderView | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<OrderView>(`/api/orders/${token}`).then(setOrder, (e) => setError(e.message))
  }, [token])

  if (error) return <p className="error" role="alert">{error}</p>
  if (!order) return <p className="muted">Loading your order…</p>

  return (
    <div className="stack">
      <div>
        <p className="sa-eyebrow">Your order</p>
        <h1 className="sa-heading">You’re all <i>set</i>, {order.firstName}</h1>
        <p className="muted small" style={{ margin: 0 }}>
          These items are held for you. Bookmark this page — it’s your receipt.
        </p>
      </div>
      <div className="sa-card">
        <ul className="lines">
          {order.items.map((i, n) => (
            <li key={n}>
              <span>{i.title}</span>
              <span className="figure">{money(i.price_cents)}</span>
            </li>
          ))}
        </ul>
        <div className="total">
          <span className="sa-eyebrow">Due at pickup</span>
          <span className="figure">{money(order.totalCents)}</span>
        </div>
      </div>
      <div className="sa-card sa-card--raised sa-card--flush small">
        The seller will text you to set up pickup. You pay when you pick up.
      </div>
    </div>
  )
}
