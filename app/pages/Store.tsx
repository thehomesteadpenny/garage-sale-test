import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError, api, money, photoUrl, postJson, type Listing } from '../lib'

const CART_KEY = 'gs_cart'

function loadCart(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((n) => Number.isInteger(n)) : []
  } catch {
    return []
  }
}

function saveCart(ids: number[]) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(ids))
  } catch {
    // Cart just won't survive a refresh in this browser.
  }
}

export function Store() {
  const [listings, setListings] = useState<Listing[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [cart, setCart] = useState<number[]>(loadCart)
  const [checkingOut, setCheckingOut] = useState(false)
  const [notice, setNotice] = useState('')

  async function refresh() {
    try {
      const data = await api<{ listings: Listing[] }>('/api/listings')
      setListings(data.listings)
      setLoadError('')
      return data.listings
    } catch (e) {
      setLoadError((e as Error).message)
      return null
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  // Drop anything from the cart that is no longer for sale.
  useEffect(() => {
    if (!listings) return
    const live = new Set(listings.map((l) => l.id))
    setCart((c) => c.filter((id) => live.has(id)))
  }, [listings])

  useEffect(() => saveCart(cart), [cart])

  const inCart = useMemo(() => (listings ?? []).filter((l) => cart.includes(l.id)), [listings, cart])
  const total = inCart.reduce((sum, l) => sum + l.price_cents, 0)

  function toggle(id: number) {
    setNotice('')
    setCart((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  }

  if (checkingOut && inCart.length > 0) {
    return (
      <Checkout
        items={inCart}
        total={total}
        onBack={() => setCheckingOut(false)}
        onUnavailable={async (ids) => {
          setCart((c) => c.filter((id) => !ids.includes(id)))
          await refresh()
          setCheckingOut(false)
          setNotice(
            ids.length === 1
              ? 'Someone else just claimed one of your items, so we took it out of your cart.'
              : `Someone else just claimed ${ids.length} of your items, so we took them out of your cart.`,
          )
        }}
      />
    )
  }

  return (
    <div className="stack">
      <div>
        <p className="sa-eyebrow">Everything still for sale</p>
        <h1 className="sa-heading">Take a <i>look</i></h1>
        <p className="muted small" style={{ margin: 0 }}>
          Pick what you want, claim it, and pay when you pick it up.
        </p>
      </div>

      {notice && <div className="sa-card sa-card--accent" role="status">{notice}</div>}
      {loadError && <p className="error" role="alert">{loadError}</p>}
      {listings === null && !loadError && <p className="muted">Loading the sale…</p>}
      {listings?.length === 0 && (
        <div className="sa-card">Nothing is listed right now. Check back soon.</div>
      )}

      {listings && listings.length > 0 && (
        <div className="grid">
          {listings.map((l) => {
            const picked = cart.includes(l.id)
            return (
              <article key={l.id} className="sa-card item">
                <img src={photoUrl(l.photo_key)} alt={l.title} loading="lazy" />
                <div className="item__body">
                  <div className="item__title">{l.title}</div>
                  <div className="item__price">{money(l.price_cents)}</div>
                  <button
                    className="sa-btn sa-btn--quiet"
                    aria-pressed={picked}
                    onClick={() => toggle(l.id)}
                  >
                    {picked ? 'In your cart ✓' : 'Add to cart'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {inCart.length > 0 && (
        <div className="sa-card cartbar">
          <div>
            <div className="figure" style={{ fontSize: 22 }}>{money(total)}</div>
            <div className="small muted">
              {inCart.length} {inCart.length === 1 ? 'item' : 'items'} in your cart
            </div>
          </div>
          <button className="sa-btn" onClick={() => setCheckingOut(true)}>Check out</button>
        </div>
      )}
    </div>
  )
}

function Checkout(props: {
  items: Listing[]
  total: number
  onBack: () => void
  onUnavailable: (ids: number[]) => void
}) {
  const [checkoutId] = useState(() => crypto.randomUUID())
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!firstName.trim() || !lastName.trim()) return setError('Add your first and last name.')
    if (phone.replace(/\D/g, '').length < 10) return setError('Add a phone number with area code.')
    setBusy(true)
    try {
      const { token } = await postJson<{ token: string }>('/api/checkout', {
        checkoutId,
        listingIds: props.items.map((i) => i.id),
        firstName,
        lastName,
        phone,
      })
      try {
        localStorage.removeItem(CART_KEY)
      } catch {
        // Nothing to clear.
      }
      window.location.assign(`/order/${token}`)
    } catch (err) {
      setBusy(false)
      if (err instanceof ApiError && err.status === 409) {
        props.onUnavailable((err.body.unavailableIds as number[]) ?? [])
      } else {
        setError((err as Error).message)
      }
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div>
        <p className="sa-eyebrow">Checkout</p>
        <h1 className="sa-heading">Almost <i>done</i></h1>
      </div>

      <div className="sa-card">
        <ul className="lines">
          {props.items.map((i) => (
            <li key={i.id}>
              <span>{i.title}</span>
              <span className="figure">{money(i.price_cents)}</span>
            </li>
          ))}
        </ul>
        <div className="total">
          <span className="sa-eyebrow">Due at pickup</span>
          <span className="figure">{money(props.total)}</span>
        </div>
      </div>

      <div className="sa-card stack">
        <div className="two">
          <div className="field">
            <label htmlFor="first">First name</label>
            <input id="first" className="sa-field" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="last">Last name</label>
            <input id="last" className="sa-field" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="phone">Phone number</label>
          <input id="phone" className="sa-field" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <span className="small muted">The seller uses this to set up pickup. It isn’t shown to anyone else.</span>
        </div>
        {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <div className="row">
          <button type="button" className="sa-btn sa-btn--quiet" onClick={props.onBack} disabled={busy}>Back to the sale</button>
          <button type="submit" className="sa-btn push" disabled={busy}>
            {busy ? 'Claiming…' : 'Claim these items'}
          </button>
        </div>
      </div>
    </form>
  )
}
