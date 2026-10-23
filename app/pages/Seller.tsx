import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api, compressPhoto, money, photoUrl, postJson, type Listing } from '../lib'

type Tab = 'add' | 'listings' | 'orders'
type Draft = { key: string; blob: Blob; preview: string; title: string; price: string; error: string; saved: boolean }
type SellerOrder = {
  id: string
  first_name: string
  last_name: string
  phone: string
  total_cents: number
  created_at: string
  items: { title: string; price_cents: number }[]
}

const STATUS_LABEL: Record<string, string> = {
  available: 'For sale',
  pending_pickup: 'Claimed',
  unavailable: 'Hidden',
}

export function Seller() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('add')

  useEffect(() => {
    api('/api/seller/me').then(() => setLoggedIn(true), () => setLoggedIn(false))
  }, [])

  if (loggedIn === null) return <p className="muted">Loading…</p>
  if (!loggedIn) return <Login onDone={() => setLoggedIn(true)} />

  return (
    <div className="stack">
      <div className="row">
        <div>
          <p className="sa-eyebrow">Seller page</p>
          <h1 className="sa-heading" style={{ marginBottom: 0 }}>Your <i>sale</i></h1>
        </div>
        <button
          className="sa-btn sa-btn--quiet push"
          onClick={async () => {
            await postJson('/api/seller/logout', {})
            setLoggedIn(false)
          }}
        >
          Log out
        </button>
      </div>
      <div className="sa-tabs" role="tablist">
        {(['add', 'listings', 'orders'] as Tab[]).map((t) => (
          <button key={t} className="sa-tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'add' ? 'Add items' : t === 'listings' ? 'Listings' : 'Orders'}
          </button>
        ))}
      </div>
      {tab === 'add' && <AddItems onAdded={() => setTab('listings')} />}
      {tab === 'listings' && <Listings />}
      {tab === 'orders' && <Orders />}
    </div>
  )
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await postJson('/api/seller/login', { password })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className="sa-card stack" onSubmit={submit} style={{ maxWidth: 420 }}>
      <div>
        <p className="sa-eyebrow">Seller page</p>
        <h1 className="sa-heading" style={{ marginBottom: 0 }}>Welcome <i>back</i></h1>
      </div>
      <div className="field">
        <label htmlFor="pw">Password</label>
        <input id="pw" className="sa-field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="sa-btn" disabled={busy || !password}>{busy ? 'Checking…' : 'Log in'}</button>
    </form>
  )
}

function AddItems({ onAdded }: { onAdded: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [preparing, setPreparing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function pick(files: FileList | null) {
    if (!files?.length) return
    setPreparing(true)
    setMessage('')
    const next: Draft[] = []
    const problems: string[] = []
    for (const file of Array.from(files)) {
      try {
        const blob = await compressPhoto(file)
        next.push({ key: crypto.randomUUID(), blob, preview: URL.createObjectURL(blob), title: '', price: '', error: '', saved: false })
      } catch (e) {
        problems.push((e as Error).message)
      }
    }
    setDrafts((d) => [...d, ...next])
    setPreparing(false)
    if (problems.length) setMessage(problems.join(' '))
  }

  function update(key: string, patch: Partial<Draft>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  }

  function remove(key: string) {
    setDrafts((ds) => {
      const gone = ds.find((d) => d.key === key)
      if (gone) URL.revokeObjectURL(gone.preview)
      return ds.filter((d) => d.key !== key)
    })
  }

  async function saveAll() {
    setSaving(true)
    setMessage('')
    let failed = 0
    for (const d of drafts) {
      if (d.saved) continue
      if (!d.title.trim() || !/^\$?\d{1,6}(\.\d{1,2})?$/.test(d.price.trim())) {
        update(d.key, { error: 'Add a title and a price, like 5 or 12.50.' })
        failed++
        continue
      }
      const form = new FormData()
      form.append('photo', d.blob, 'photo.jpg')
      form.append('title', d.title)
      form.append('price', d.price)
      try {
        await api('/api/seller/listings', { method: 'POST', body: form })
        update(d.key, { saved: true, error: '' })
      } catch (e) {
        update(d.key, { error: e instanceof ApiError ? e.message : 'Couldn’t save this one.' })
        failed++
      }
    }
    setSaving(false)
    if (failed === 0) {
      drafts.forEach((d) => URL.revokeObjectURL(d.preview))
      setDrafts([])
      onAdded()
    } else {
      setDrafts((ds) => ds.filter((d) => !d.saved))
      setMessage(failed === 1 ? 'One item still needs fixing.' : `${failed} items still need fixing.`)
    }
  }

  return (
    <div className="stack">
      <div className="sa-card stack">
        <p style={{ margin: 0 }}>Each photo becomes one listing. A bundle sold together can be one photo.</p>
        <label className="sa-btn sa-btn--quiet filepick" style={{ justifySelf: 'start' }}>
          {preparing ? 'Getting photos ready…' : 'Choose photos'}
          <input type="file" accept="image/*" multiple disabled={preparing} onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
        </label>
      </div>

      {drafts.map((d) => (
        <div key={d.key} className="sa-card sa-card--flush draft">
          <img src={d.preview} alt="" />
          <div className="stack" style={{ gap: 'var(--space-3)' }}>
            <div className="field">
              <label htmlFor={`t-${d.key}`}>Title</label>
              <input id={`t-${d.key}`} className="sa-field" value={d.title} maxLength={80} onChange={(e) => update(d.key, { title: e.target.value, error: '' })} />
            </div>
            <div className="row" style={{ alignItems: 'end' }}>
              <div className="field" style={{ width: 140 }}>
                <label htmlFor={`p-${d.key}`}>Price</label>
                <div className="sa-money">
                  <span>$</span>
                  <input id={`p-${d.key}`} inputMode="decimal" value={d.price} onChange={(e) => update(d.key, { price: e.target.value, error: '' })} />
                </div>
              </div>
              <button className="sa-btn sa-btn--quiet push" onClick={() => remove(d.key)} disabled={saving}>Remove</button>
            </div>
            {d.error && <p className="error small" style={{ margin: 0 }}>{d.error}</p>}
          </div>
        </div>
      ))}

      {message && <p className="error" role="alert" style={{ margin: 0 }}>{message}</p>}
      {drafts.length > 0 && (
        <button className="sa-btn" style={{ justifySelf: 'start' }} onClick={saveAll} disabled={saving}>
          {saving ? 'Saving…' : `Put ${drafts.length === 1 ? 'it' : `all ${drafts.length}`} in the sale`}
        </button>
      )}
    </div>
  )
}

function Listings() {
  const [listings, setListings] = useState<Listing[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<{ listings: Listing[] }>('/api/seller/listings').then((d) => setListings(d.listings), (e) => setError(e.message))
  }, [])
  if (error) return <p className="error" role="alert">{error}</p>
  if (!listings) return <p className="muted">Loading…</p>
  if (listings.length === 0) return <div className="sa-card">No listings yet. Add a few photos to get started.</div>
  return (
    <div className="sa-card">
      {listings.map((l) => (
        <div key={l.id} className="listrow">
          <img src={photoUrl(l.photo_key)} alt="" loading="lazy" />
          <div>
            <div style={{ fontWeight: 600 }}>{l.title}</div>
            <div className="figure small">{money(l.price_cents)}</div>
          </div>
          <span className={`sa-chip ${l.status === 'available' ? 'sa-chip--b' : 'sa-chip--accent'}`}>
            {STATUS_LABEL[l.status ?? ''] ?? l.status}
          </span>
        </div>
      ))}
    </div>
  )
}

function Orders() {
  const [orders, setOrders] = useState<SellerOrder[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<{ orders: SellerOrder[] }>('/api/seller/orders').then((d) => setOrders(d.orders), (e) => setError(e.message))
  }, [])
  if (error) return <p className="error" role="alert">{error}</p>
  if (!orders) return <p className="muted">Loading…</p>
  if (orders.length === 0) return <div className="sa-card">No orders yet. They’ll show up here as people claim things.</div>
  return (
    <div className="stack">
      {orders.map((o) => (
        <div key={o.id} className="sa-card">
          <div className="row">
            <div>
              <div style={{ fontWeight: 700 }}>{o.first_name} {o.last_name}</div>
              <a className="small" href={`tel:${o.phone}`} style={{ color: 'var(--ink-accent)' }}>{o.phone}</a>
            </div>
            <div className="figure push" style={{ fontSize: 22 }}>{money(o.total_cents)}</div>
          </div>
          <ul className="lines" style={{ marginTop: 'var(--space-2)' }}>
            {o.items.map((i, n) => (
              <li key={n}>
                <span>{i.title}</span>
                <span className="figure">{money(i.price_cents)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
