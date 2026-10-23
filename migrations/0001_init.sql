-- Tiny test schema. Money is stored as whole cents.

CREATE TABLE listings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  photo_key   TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'available'
              CHECK (status IN ('available', 'pending_pickup', 'unavailable')),
  order_id    TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX listings_status ON listings (status, id);
CREATE INDEX listings_order ON listings (order_id);

CREATE TABLE orders (
  id          TEXT    PRIMARY KEY,
  token       TEXT    NOT NULL UNIQUE,
  first_name  TEXT    NOT NULL,
  last_name   TEXT    NOT NULL,
  phone       TEXT    NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Price is copied at checkout so later price changes never touch an order.
CREATE TABLE order_items (
  order_id    TEXT    NOT NULL REFERENCES orders (id),
  listing_id  INTEGER NOT NULL REFERENCES listings (id),
  title       TEXT    NOT NULL,
  price_cents INTEGER NOT NULL,
  PRIMARY KEY (order_id, listing_id)
);

-- Always empty. Checkout inserts (claimed_count = requested_count) here as the
-- last step of its batch; a 0 fails the CHECK and rolls the whole batch back,
-- so an order is either complete or never existed.
CREATE TABLE claim_guard (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

CREATE TABLE sessions (
  token      TEXT    PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
