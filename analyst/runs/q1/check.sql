WITH gross AS (
    SELECT c.region, SUM(oi.quantity * oi.unit_price * (1 - oi.discount_pct) * o.fx_rate_to_usd) AS gross_usd, COUNT(*) AS gross_lines
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    JOIN customers c ON c.customer_id = o.customer_id
    WHERE o.status = 'completed' AND o.order_date >= '2025-04-01' AND o.order_date < '2026-04-01'
      AND COALESCE(c.is_test_account, 0) <> 1
    GROUP BY c.region
),
refunds AS (
    SELECT c.region, SUM(r.refund_amount * o.fx_rate_to_usd) AS refunds_usd, COUNT(*) AS refund_lines
    FROM returns r
    JOIN order_items oi ON oi.order_item_id = r.order_item_id
    JOIN orders o ON o.order_id = oi.order_id
    JOIN customers c ON c.customer_id = o.customer_id
    WHERE o.status = 'completed' AND r.return_date >= '2025-04-01' AND r.return_date < '2026-04-01'
      AND COALESCE(c.is_test_account, 0) <> 1
    GROUP BY c.region
)
SELECT g.region, ROUND(g.gross_usd, 2) AS gross_usd, ROUND(COALESCE(f.refunds_usd, 0), 2) AS refunds_usd, ROUND(COALESCE(g.gross_usd, 0) - COALESCE(f.refunds_usd, 0), 2) AS net_revenue_usd, g.gross_lines, f.refund_lines
FROM gross g
LEFT JOIN refunds f ON f.region = g.region
UNION ALL
SELECT f.region, 0, ROUND(f.refunds_usd, 2), ROUND(-f.refunds_usd, 2), 0, f.refund_lines
FROM refunds f
WHERE f.region NOT IN (SELECT region FROM gross)
ORDER BY net_revenue_usd DESC;
