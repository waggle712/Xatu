# Razorpay webhook fixtures

Shapes of `payment.captured`, `payment.failed` and `order.paid` webhooks, written from Razorpay's
API documentation (test mode, Nov 2026). There was no Razorpay account yet, so these are
**doc-derived, not recorded**. Once test-mode keys exist, re-record them from real deliveries
(Dashboard → Webhooks → a test payment) and replace these files; the tests fill in ids and amounts.

Placeholders: `__ORDER_ID__` (Razorpay order id), `__PAYMENT_ID__`, `__AMOUNT__` (paise),
`__CREATED_AT__` (unix seconds).

`refund.processed` and `refund.failed` (prompt 16) also use `__REFUND_ID__` and `__RECEIPT__`.
