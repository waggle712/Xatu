-- Prompt 15: Razorpay payments and webhooks (test mode only).

-- ── Webhook events: stored raw before processing ──
-- Only events with a valid signature are unique per provider event id, so a forged request can
-- never take a real event's id first. The exact bytes are kept so the signature can be re-checked.
DROP INDEX "payment_webhook_events_provider_provider_event_id_key";
ALTER TABLE "payment_webhook_events" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "raw_body" TEXT NOT NULL DEFAULT '',
ADD COLUMN "signature" TEXT;
ALTER TABLE "payment_webhook_events" ALTER COLUMN "raw_body" DROP DEFAULT;
CREATE INDEX "payment_webhook_events_provider_provider_event_id_idx" ON "payment_webhook_events"("provider", "provider_event_id");
CREATE UNIQUE INDEX "payment_webhook_events_valid_event_key" ON "payment_webhook_events"("provider", "provider_event_id") WHERE "signature_valid";
CREATE INDEX "payment_webhook_events_processed_at_created_at_idx" ON "payment_webhook_events"("processed_at", "created_at");

-- ── Payments ──
ALTER TABLE "payments" ADD COLUMN "last_checked_at" TIMESTAMP(3),
ADD COLUMN "verified_by" TEXT;
-- (payments_amount_check already exists from the init migration.)
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_check" CHECK ("currency" = 'INR');
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_check" CHECK ("verified_by" IS NULL OR "verified_by" IN ('webhook', 'fetch'));
-- One open payment per order: a second Pay tap reuses it and can never create a second charge.
CREATE UNIQUE INDEX "payments_one_open_per_order" ON "payments"("order_id") WHERE "status" IN ('initiated', 'pending', 'verified');
