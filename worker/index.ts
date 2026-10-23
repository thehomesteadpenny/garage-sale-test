import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

type Env = {
  DB: D1Database
  PHOTOS: KVNamespace
  ASSETS: Fetcher
  SELLER_PASSWORD?: string
}

const app = new Hono<{ Bindings: Env }>()

const SESSION_COOKIE = 'gs_session'
const SESSION_DAYS = 30
const MAX_CART = 50 // D1 allows 100 bound values per statement
const MAX_PHOTO_BYTES = 3 * 1024 * 1024
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function parseCents(input: unknown): number | null {
  const s = String(input ?? '').trim().replace(/^\$/, '')
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'))
}

function cleanName(input: unknown): string | null {
  const s = String(input ?? '').trim()
  return s.length >= 1 && s.length <= 50 ? s : null
}

function cleanPhone(input: unknown): string | null {
  const digits = String(input ?? '').replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15 ? digits : null
}

// ---------- Public: storefront ----------

app.get('/api/listings', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, price_cents, photo_key FROM listings
     WHERE status = 'available' ORDER BY id DESC`,
  ).all()
  return c.json({ listings: results })
})

app.get('/photos/:id', async (c) => {
  const id = c.req.param('id')
  if (!/^[0-9a-f-]{36}$/.test(id)) return c.notFound()
  const photo = await c.env.PHOTOS.getWithMetadata<{ type: string }>(`p/${id}`, 'arrayBuffer')
  if (!photo.value) return c.notFound()
  return new Response(photo.value, {
    headers: {
      'Content-Type': photo.metadata?.type ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
})

app.post('/api/checkout', async (c) => {
  const body = await c.req.json().catch(() => null)
  const orderId = String(body?.checkoutId ?? '')
  const firstName = cleanName(body?.firstName)
  const lastName = cleanName(body?.lastName)
  const phone = cleanPhone(body?.phone)
  const rawIds: unknown[] = Array.isArray(body?.listingIds) ? body.listingIds : []
  const ids = [...new Set(rawIds.map(Number))].filter((n) => Number.isInteger(n) && n > 0)

  if (!/^[0-9a-f-]{36}$/.test(orderId)) return c.json({ error: 'Something went wrong. Refresh the page and try again.' }, 400)
  if (!firstName || !lastName) return c.json({ error: 'Add your first and last name.' }, 400)
  if (!phone) return c.json({ error: 'Add a phone number with area code.' }, 400)
  if (ids.length === 0 || ids.length !== rawIds.length) return c.json({ error: 'Your cart is empty.' }, 400)
  if (ids.length > MAX_CART) return c.json({ error: `You can claim up to ${MAX_CART} items in one order.` }, 400)

  const db = c.env.DB
  const token = randomToken()
  const marks = ids.map(() => '?').join(',')
  const claimable = `status = 'available' AND id IN (${marks})`

  try {
    await db.batch([
      db.prepare(
        `INSERT INTO orders (id, token, first_name, last_name, phone, total_cents)
         VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(SUM(price_cents), 0) FROM listings WHERE ${claimable}))`,
      ).bind(orderId, token, firstName, lastName, phone, ...ids),
      db.prepare(
        `INSERT INTO order_items (order_id, listing_id, title, price_cents)
         SELECT ?, id, title, price_cents FROM listings WHERE ${claimable}`,
      ).bind(orderId, ...ids),
      db.prepare(`UPDATE listings SET status = 'pending_pickup', order_id = ? WHERE ${claimable}`).bind(orderId, ...ids),
      db.prepare(`INSERT INTO claim_guard (ok) SELECT (SELECT COUNT(*) FROM listings WHERE order_id = ?) = ?`).bind(orderId, ids.length),
      db.prepare(`DELETE FROM claim_guard`),
    ])
  } catch {
    // A retry of an order that already went through: hand back the same order.
    const existing = await db.prepare(`SELECT token FROM orders WHERE id = ?`).bind(orderId).first<{ token: string }>()
    if (existing) return c.json({ token: existing.token })

    const { results } = await db.prepare(`SELECT id FROM listings WHERE ${claimable}`).bind(...ids).all<{ id: number }>()
    const stillAvailable = new Set(results.map((r) => r.id))
    const unavailableIds = ids.filter((id) => !stillAvailable.has(id))
    if (unavailableIds.length > 0) {
      return c.json({ error: 'Some items were just claimed by someone else.', unavailableIds }, 409)
    }
    return c.json({ error: 'Something went wrong. Try again in a moment.' }, 500)
  }

  return c.json({ token }, 201)
})

app.get('/api/orders/:token', async (c) => {
  const token = c.req.param('token')
  const order = await c.env.DB.prepare(
    `SELECT id, first_name, total_cents, created_at FROM orders WHERE token = ?`,
  ).bind(token).first<{ id: string; first_name: string; total_cents: number; created_at: string }>()
  if (!order) return c.json({ error: 'We couldn’t find that order.' }, 404)
  const { results: items } = await c.env.DB.prepare(
    `SELECT title, price_cents FROM order_items WHERE order_id = ? ORDER BY rowid`,
  ).bind(order.id).all()
  return c.json({ firstName: order.first_name, totalCents: order.total_cents, createdAt: order.created_at, items })
})

// ---------- Seller ----------

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
}

app.post('/api/seller/login', async (c) => {
  const expected = c.env.SELLER_PASSWORD ?? ''
  if (expected.length < 8) {
    return c.json({ error: 'No seller password is set up yet. Add one in your Cloudflare settings.' }, 503)
  }
  const body = await c.req.json().catch(() => null)
  const given = String(body?.password ?? '')
  const ok = crypto.subtle.timingSafeEqual(await sha256(given), await sha256(expected))
  if (!ok) return c.json({ error: 'That password didn’t match.' }, 401)

  const token = randomToken()
  const expires = Date.now() + SESSION_DAYS * 86_400_000
  await c.env.DB.prepare(`INSERT INTO sessions (token, expires_at) VALUES (?, ?)`).bind(token, expires).run()
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86_400,
  })
  return c.json({ ok: true })
})

app.post('/api/seller/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await c.env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run()
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

app.use('/api/seller/*', async (c, next) => {
  if (c.req.path === '/api/seller/login' || c.req.path === '/api/seller/logout') return next()
  const token = getCookie(c, SESSION_COOKIE)
  const session = token
    ? await c.env.DB.prepare(`SELECT expires_at FROM sessions WHERE token = ?`).bind(token).first<{ expires_at: number }>()
    : null
  if (!session || session.expires_at < Date.now()) return c.json({ error: 'Log in to keep going.' }, 401)
  await next()
})

app.get('/api/seller/me', (c) => c.json({ ok: true }))

app.post('/api/seller/listings', async (c) => {
  const form = await c.req.parseBody()
  const photo = form.photo
  const title = String(form.title ?? '').trim()
  const priceCents = parseCents(form.price)

  if (!(photo instanceof File)) return c.json({ error: 'Add a photo.' }, 400)
  if (!PHOTO_TYPES.includes(photo.type)) return c.json({ error: 'Photos need to be JPEG, PNG or WebP.' }, 400)
  if (photo.size > MAX_PHOTO_BYTES) return c.json({ error: 'That photo is too large.' }, 400)
  if (title.length < 1 || title.length > 80) return c.json({ error: 'Add a title (up to 80 characters).' }, 400)
  if (priceCents === null) return c.json({ error: 'Add a price, like 5 or 12.50.' }, 400)

  const photoId = crypto.randomUUID()
  await c.env.PHOTOS.put(`p/${photoId}`, await photo.arrayBuffer(), { metadata: { type: photo.type } })
  try {
    const row = await c.env.DB.prepare(
      `INSERT INTO listings (title, price_cents, photo_key) VALUES (?, ?, ?) RETURNING id`,
    ).bind(title, priceCents, photoId).first<{ id: number }>()
    return c.json({ id: row?.id }, 201)
  } catch (err) {
    await c.env.PHOTOS.delete(`p/${photoId}`)
    throw err
  }
})

app.get('/api/seller/listings', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, price_cents, photo_key, status FROM listings ORDER BY id DESC`,
  ).all()
  return c.json({ listings: results })
})

app.get('/api/seller/orders', async (c) => {
  const { results: orders } = await c.env.DB.prepare(
    `SELECT id, first_name, last_name, phone, total_cents, created_at FROM orders ORDER BY created_at DESC`,
  ).all<{ id: string }>()
  const { results: items } = await c.env.DB.prepare(
    `SELECT order_id, title, price_cents FROM order_items ORDER BY rowid`,
  ).all<{ order_id: string; title: string; price_cents: number }>()
  return c.json({
    orders: orders.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id) })),
  })
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default app
