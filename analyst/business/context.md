# Business context and rules

1. Fiscal year runs 1 April to 31 March. FY2025 = 2025-04-01 to 2026-03-31. Do not use calendar years for FY questions.
2. Revenue comes only from orders with status = 'completed'. Cancelled and pending orders are excluded everywhere.
3. Test accounts (customers.is_test_account = 1) are excluded from every metric.
4. All money is converted to USD with orders.fx_rate_to_usd, the rate on the order date. Do not use any other rate.
5. Gross revenue is attributed by order_date. Refunds are attributed by return_date, not by the order's date.
   So a refund issued in FY2025 for an order placed in FY2024 counts against FY2025 net revenue.
6. Net revenue = gross revenue (rule 5 timing) minus refunds (rule 5 timing). Round to 2 decimals.
7. Region and segment come from the customer record, not from the order.
8. Retention for a fiscal year compares Q3 buyers with Q4 buyers of the same fiscal year. A customer must have completed orders in both quarters to be retained.
9. Retention rate = retained ÷ Q3 buyers, rounded to 3 decimals, per segment.
10. Output rules: sort as the question asks; list only the rows the question asks for.
