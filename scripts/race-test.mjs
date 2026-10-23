// Checks that two buyers can never claim the same item.
// Usage: node scripts/race-test.mjs [baseUrl]   (seller password from SELLER_PASSWORD)
// Note: this adds test listings and orders to whatever site you point it at.

const base = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '')
const password = process.env.SELLER_PASSWORD ?? 'local-test-password'
let failures = 0

function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures++
}

async function login() {
  const res = await fetch(`${base}/api/seller/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`)
  return res.headers.get('set-cookie').split(';')[0]
}

async function addListing(cookie, title, price) {
  const form = new FormData()
  form.append('photo', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'p.jpg')
  form.append('title', title)
  form.append('price', price)
  const res = await fetch(`${base}/api/seller/listings`, { method: 'POST', headers: { cookie }, body: form })
  if (res.status !== 201) throw new Error(`Add listing failed: ${res.status} ${await res.text()}`)
  return (await res.json()).id
}

function checkout(listingIds, name, checkoutId = crypto.randomUUID()) {
  return fetch(`${base}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkoutId, listingIds, firstName: name, lastName: 'Tester', phone: '555-010-0000' }),
  }).then(async (res) => ({ status: res.status, body: await res.json() }))
}

async function availableIds() {
  const res = await fetch(`${base}/api/listings`)
  return new Set((await res.json()).listings.map((l) => l.id))
}

const cookie = await login()
const stamp = Date.now().toString(36)

// 1. Two buyers, one item, same instant.
{
  const id = await addListing(cookie, `Race lamp ${stamp}`, '10')
  const results = await Promise.all([checkout([id], 'Ann'), checkout([id], 'Bea')])
  const codes = results.map((r) => r.status).sort()
  check(codes[0] === 201 && codes[1] === 409, `two buyers, one item: one wins, one is told no (got ${codes.join(', ')})`)
}

// 2. Ten buyers, one item.
{
  const id = await addListing(cookie, `Race chair ${stamp}`, '25.50')
  const results = await Promise.all(Array.from({ length: 10 }, (_, n) => checkout([id], `Buyer${n}`)))
  const wins = results.filter((r) => r.status === 201).length
  const losses = results.filter((r) => r.status === 409).length
  check(wins === 1 && losses === 9, `ten buyers, one item: exactly one winner (got ${wins} wins, ${losses} told no)`)
}

// 3. Overlapping carts: no half-orders. A wants [x, y], B wants [y, z].
{
  const x = await addListing(cookie, `Race x ${stamp}`, '1')
  const y = await addListing(cookie, `Race y ${stamp}`, '2')
  const z = await addListing(cookie, `Race z ${stamp}`, '3.25')
  const [a, b] = await Promise.all([checkout([x, y], 'Cat'), checkout([y, z], 'Dee')])
  const oneWinner = [a.status, b.status].sort().join() === '201,409'
  const avail = await availableIds()
  const loserOnly = a.status === 201 ? z : x
  check(oneWinner, `overlapping carts: one order goes through (got ${a.status}, ${b.status})`)
  check(avail.has(loserOnly), 'overlapping carts: the losing order claimed nothing (its other item is still for sale)')
  const loser = a.status === 201 ? b : a
  check(JSON.stringify(loser.body.unavailableIds) === JSON.stringify([y]), 'overlapping carts: the loser is told exactly which item is gone')
}

// 4. Same checkout sent twice (double tap, flaky signal): one order, same receipt.
{
  const id = await addListing(cookie, `Race rug ${stamp}`, '7')
  const sameId = crypto.randomUUID()
  const first = await checkout([id], 'Eve', sameId)
  const again = await checkout([id], 'Eve', sameId)
  check(first.status === 201 && again.status === 200 && first.body.token === again.body.token, 'double-submitted checkout returns the same order')

  const receipt = await fetch(`${base}/api/orders/${first.body.token}`).then((r) => r.json())
  check(receipt.totalCents === 700 && receipt.items.length === 1, 'receipt has the right items and total')
  check(!JSON.stringify(receipt).includes('5550100000'), 'receipt does not show the phone number')
}

// 5. Public pages never show buyer details.
{
  const text = await fetch(`${base}/api/listings`).then((r) => r.text())
  check(!text.includes('5550100000') && !text.includes('Tester'), 'public listings do not include buyer names or phones')
  const orders = await fetch(`${base}/api/seller/orders`)
  check(orders.status === 401, 'seller orders are locked without logging in')
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
