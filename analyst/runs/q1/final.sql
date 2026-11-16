WITH gross AS (
    SELECT
        c.region,
        SUM(oi.quantity * oi.unit_price * (1 - oi.discount_pct) * o.fx_rate_to_usd) AS gross_usd
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    JOIN customers c ON c.customer_id = o.customer_id
    WHERE o.status = 'completed'
      AND o.order_date >= '2025-04-01'
      AND o.order_date <  '2026-04-01'
      AND c.is_test_account = 0
    GROUP BY c.region
),
item_returns AS (
    SELECT
        r.order_item_id,
        SUM(r.refund_amount) AS refund_amount
    FROM returns r
    WHERE r.return_date >= '2025-04-01'
      AND r.return_date <  '2026-04-01'
    GROUP BY r.order_item_id
),
refunds AS (
    SELECT
        c.region,
        SUM(ir.refund_amount * o.fx_rate_to_usd) AS refund_usd
    FROM item_returns ir
    JOIN order_items oi ON oi.order_item_id = ir.order_item_id
    JOIN orders o ON o.order_id = oi.order_id
    JOIN customers c ON c.customer_id = o.customer_id
    WHERE o.status = 'completed'
      AND c.is_test_account = 0
    GROUP BY c.region
),
net AS (
    SELECT
        g.region,
        ROUND(COALESCE(g.gross_usd, 0) - COALESCE(rf.refund_usd, 0), 2) AS net_revenue_usd
    FROM gross g
    LEFT JOIN refunds rf ON rf.region = g.region
)
SELECT region, net_revenue_usd
FROM net
WHERE net_revenue_usd > 100000
ORDER BY net_revenue_usd DESC, region ASC;
