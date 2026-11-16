-- FY2025 Q3-to-Q4 customer retention rate by segment (sales.sqlite)
-- Q3 = 2025-10-01 to 2025-12-31; Q4 = 2026-01-01 to 2026-03-31
-- Base: distinct non-test customers with >=1 completed order in Q3.
-- Retained: base customers with >=1 completed order in Q4.
-- retention_ratio is a ratio (not percent), rounded to 3 decimals.
WITH q3_buyers AS (
    SELECT DISTINCT o.customer_id
    FROM orders o
    WHERE o.status = 'completed'
      AND o.order_date >= '2025-10-01'
      AND o.order_date <  '2026-01-01'
),
q4_buyers AS (
    SELECT DISTINCT o.customer_id
    FROM orders o
    WHERE o.status = 'completed'
      AND o.order_date >= '2026-01-01'
      AND o.order_date <  '2026-04-01'
),
base AS (
    SELECT
        c.segment,
        c.customer_id,
        CASE
            WHEN EXISTS (
                SELECT 1 FROM q4_buyers q4
                WHERE q4.customer_id = c.customer_id
            ) THEN 1
            ELSE 0
        END AS retained
    FROM customers c
    WHERE COALESCE(c.is_test_account, 0) <> 1
      AND EXISTS (
            SELECT 1 FROM q3_buyers q3
            WHERE q3.customer_id = c.customer_id
      )
)
SELECT
    segment,
    SUM(retained)                                        AS retained_count,
    COUNT(*)                                             AS base_count,
    ROUND(CAST(SUM(retained) AS REAL) / COUNT(*), 3)     AS retention_ratio
FROM base
GROUP BY segment
ORDER BY segment ASC;
