# Garage Sale — tiny Cloudflare test

A small proof that the garage sale app can run entirely on one free Cloudflare account,
set up with one button. It is **not** the full app. It covers:

- Seller login with one password
- Adding items: pick several photos, each becomes a listing (photos are shrunk in the browser first)
- Public shop page with a cart
- Checkout that can never sell the same item twice, even if two people tap at the same moment
- A private receipt link for the buyer
- Seller view of listings and orders (with buyer phone numbers, seller-only)

Built with React + Vite for the pages, a Cloudflare Worker (Hono) for the server,
D1 for the database and Workers KV for photos. Styled with the Sage Awning design system.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=REPLACE_WITH_REPO_URL)

The button copies this project into your GitHub account, creates the database and photo
storage in your Cloudflare account, sets up the database tables, and puts the site live.
It asks you for one thing: the password for your seller page.

After it finishes, your shop is at `https://garage-sale-test.<your-subdomain>.workers.dev`
and your seller page is at `/seller`.

## Run it on your own computer (developers)

```bash
npm install
npm run dev
```

`npm run dev` builds the pages, sets up a local database, and starts the site at
http://localhost:8787. The local seller password comes from `.dev.vars`
(copy `.dev.vars.example` to `.dev.vars` and set `SELLER_PASSWORD`).

On Windows, if the project folder path is very long, local database commands fail with
"internal error". Add `--persist-to C:/some/short/folder` to the `wrangler` commands.

## Check that double-selling is impossible

With the site running:

```bash
npm run test:race
```

This creates test listings and fires simultaneous checkouts at them: two buyers for one
item, ten buyers for one item, overlapping carts, and a double-tapped checkout. Pass a URL
to run it against a deployed copy (it adds test items and orders there):
`SELLER_PASSWORD=... node scripts/race-test.mjs https://your-site.workers.dev`.

## How the no-double-selling works

Checkout runs as one D1 batch, which Cloudflare runs as a single transaction: create the
order, copy the items and prices, mark them claimed, then count how many were actually
claimed. If the count is short (someone else got one first), a check constraint fails and
the whole batch is undone, so there is never a half-finished order. See
`migrations/0001_init.sql` (`claim_guard`) and `worker/index.ts` (`/api/checkout`).

## Not in this test

Sale stages, pickup times, categories, search, packing, earnings, editing or hiding
items, rate limiting on checkout, and login lockout after wrong guesses. Those come with
the full build.
