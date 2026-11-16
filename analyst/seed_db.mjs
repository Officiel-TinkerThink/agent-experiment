// Builds the sample sales database and writes the answer key to analyst/_grader/expected.json.
// Run: node analyst/seed_db.mjs
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, "db", "sales.sqlite");
mkdirSync(join(here, "db"), { recursive: true });
mkdirSync(join(here, "_grader"), { recursive: true });
rmSync(dbPath, { force: true });
const db = new DatabaseSync(dbPath);

db.exec(`
CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, name TEXT, segment TEXT, region TEXT, signup_date TEXT, is_test_account INTEGER);
CREATE TABLE products (product_id INTEGER PRIMARY KEY, sku TEXT, name TEXT, category TEXT);
CREATE TABLE orders (order_id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(customer_id), order_date TEXT, status TEXT, currency TEXT, fx_rate_to_usd REAL);
CREATE TABLE order_items (order_item_id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(order_id), product_id INTEGER REFERENCES products(product_id), quantity INTEGER, unit_price REAL, discount_pct REAL);
CREATE TABLE returns (return_id INTEGER PRIMARY KEY, order_item_id INTEGER REFERENCES order_items(order_item_id), return_date TEXT, quantity_returned INTEGER, refund_amount REAL);
`);

// Deterministic pseudo-random generator (Park-Miller), so the data is reproducible.
let seed = 42;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const addDays = (iso, n) =>
  new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const randDate = (start, end) => {
  const span = Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000);
  return addDays(start, between(0, span));
};

const regions = ["AMER", "EMEA", "APAC"];
const segments = ["Consumer", "SMB", "Enterprise"];
const insC = db.prepare("INSERT INTO customers VALUES (?,?,?,?,?,?)");
for (let i = 1; i <= 60; i++) {
  insC.run(i, `Customer ${i}`, pick(segments), pick(regions), randDate("2023-01-01", "2025-06-30"), i > 56 ? 1 : 0);
}

const cats = ["Hardware", "Software", "Services"];
const insP = db.prepare("INSERT INTO products VALUES (?,?,?,?)");
for (let i = 1; i <= 15; i++) insP.run(i, `SKU-${100 + i}`, `Product ${i}`, cats[(i - 1) % 3]);

const baseFx = { USD: 1.0, EUR: 1.08, JPY: 0.0067 };
const insO = db.prepare("INSERT INTO orders VALUES (?,?,?,?,?,?)");
const insI = db.prepare("INSERT INTO order_items VALUES (?,?,?,?,?,?)");
const insR = db.prepare("INSERT INTO returns VALUES (?,?,?,?,?)");
let itemId = 1;
let retId = 1;
for (let o = 1; o <= 400; o++) {
  const cust = between(1, 60);
  const date = randDate("2025-01-01", "2026-03-31");
  const r = rnd();
  const status = r < 0.85 ? "completed" : r < 0.95 ? "cancelled" : "pending";
  const cur = pick(["USD", "USD", "EUR", "JPY"]);
  const fx = +(baseFx[cur] * (1 + (rnd() - 0.5) * 0.04)).toFixed(4);
  insO.run(o, cust, date, status, cur, fx);
  const localMult = cur === "JPY" ? 150 : 1;
  const nItems = between(1, 4);
  for (let k = 0; k < nItems; k++) {
    const pid = between(1, 15);
    const qty = between(1, 5);
    const price = +((20 + pid * 15) * localMult).toFixed(2);
    const disc = pick([0, 0, 0.05, 0.1, 0.15]);
    const iid = itemId++;
    insI.run(iid, o, pid, qty, price, disc);
    if (rnd() < 0.1) {
      const qr = between(1, qty);
      let rd = addDays(date, between(5, 60));
      if (rd > "2026-04-30") rd = "2026-04-30";
      insR.run(retId++, iid, rd, qr, +(qr * price * (1 - disc)).toFixed(2));
    }
  }
}

// Answer key: reference queries that encode the business rules in business/context.md.
const Q1 = `
WITH sales AS (
  SELECT c.region, SUM(oi.quantity * oi.unit_price * (1 - oi.discount_pct) * o.fx_rate_to_usd) AS gross
  FROM orders o
  JOIN customers c ON c.customer_id = o.customer_id
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status = 'completed' AND c.is_test_account = 0
    AND o.order_date BETWEEN '2025-04-01' AND '2026-03-31'
  GROUP BY c.region
),
refunds AS (
  SELECT c.region, SUM(r.refund_amount * o.fx_rate_to_usd) AS refunded
  FROM returns r
  JOIN order_items oi ON oi.order_item_id = r.order_item_id
  JOIN orders o ON o.order_id = oi.order_id
  JOIN customers c ON c.customer_id = o.customer_id
  WHERE o.status = 'completed' AND c.is_test_account = 0
    AND r.return_date BETWEEN '2025-04-01' AND '2026-03-31'
  GROUP BY c.region
)
SELECT s.region, ROUND(s.gross - COALESCE(r.refunded, 0), 2) AS net_revenue_usd
FROM sales s
LEFT JOIN refunds r ON r.region = s.region
WHERE s.gross - COALESCE(r.refunded, 0) > 100000
ORDER BY net_revenue_usd DESC`;

const Q2 = `
WITH q3 AS (
  SELECT DISTINCT o.customer_id FROM orders o
  WHERE o.status = 'completed' AND o.order_date BETWEEN '2025-10-01' AND '2025-12-31'
),
q4 AS (
  SELECT DISTINCT o.customer_id FROM orders o
  WHERE o.status = 'completed' AND o.order_date BETWEEN '2026-01-01' AND '2026-03-31'
)
SELECT c.segment,
       COUNT(*) AS q3_customers,
       SUM(CASE WHEN q4.customer_id IS NOT NULL THEN 1 ELSE 0 END) AS retained_customers,
       ROUND(1.0 * SUM(CASE WHEN q4.customer_id IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 3) AS retention_rate
FROM q3
JOIN customers c ON c.customer_id = q3.customer_id
LEFT JOIN q4 ON q4.customer_id = q3.customer_id
WHERE c.is_test_account = 0
GROUP BY c.segment
ORDER BY c.segment`;

const expected = { q1: db.prepare(Q1).all(), q2: db.prepare(Q2).all() };
writeFileSync(join(here, "_grader", "expected.json"), JSON.stringify(expected, null, 2));
console.log("orders:", db.prepare("SELECT COUNT(*) n FROM orders").get().n,
  "items:", db.prepare("SELECT COUNT(*) n FROM order_items").get().n,
  "returns:", db.prepare("SELECT COUNT(*) n FROM returns").get().n);
console.log("expected q1:", JSON.stringify(expected.q1));
console.log("expected q2:", JSON.stringify(expected.q2));
