# Business glossary

- **Gross revenue (USD):** sum over order items of quantity × unit_price × (1 − discount_pct) × fx_rate_to_usd, for completed orders only.
- **Refund (USD):** refund_amount × the parent order's fx_rate_to_usd, for returns on completed orders.
- **Net revenue (USD):** gross revenue minus refunds, using the period rules in context.md.
- **Completed order:** an order with status = 'completed'. Cancelled and pending orders are not revenue.
- **Test account:** a customer with is_test_account = 1. Excluded from all metrics.
- **Fiscal year (FY):** runs 1 April to 31 March. FY2025 = 2025-04-01 to 2026-03-31. The label is the year in which the fiscal year starts.
- **Fiscal quarter:** Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar.
- **Region:** the customer's home region (customers.region), not where the order was placed.
- **Segment:** the customer's segment (customers.segment).
- **Retained customer:** a customer with a completed order in Q3 and a completed order in Q4 of the same fiscal year.
- **Retention rate:** retained customers ÷ customers who ordered in Q3, both counted with the rules above.
