-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('pending_approval', 'approved', 'exported', 'paid', 'cancelled');

-- AlterTable
ALTER TABLE "ledger_transactions" ADD COLUMN     "idempotency_key" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "completed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "refund_requests" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failure_reason" TEXT,
ALTER COLUMN "requested_by_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "finance_rates" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "base" TEXT NOT NULL,
    "note" TEXT,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_batches" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "business_day" DATE NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'pending_approval',
    "gross_paise" BIGINT NOT NULL,
    "commission_paise" BIGINT NOT NULL,
    "commission_gst_paise" BIGINT NOT NULL,
    "tcs_paise" BIGINT NOT NULL,
    "tds_paise" BIGINT NOT NULL,
    "net_paise" BIGINT NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "exported_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "payment_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_lines" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "items_paise" BIGINT NOT NULL,
    "delivery_paise" BIGINT NOT NULL,
    "gross_paise" BIGINT NOT NULL,
    "commission_paise" BIGINT NOT NULL,
    "commission_gst_paise" BIGINT NOT NULL,
    "tcs_paise" BIGINT NOT NULL,
    "tds_paise" BIGINT NOT NULL,
    "net_paise" BIGINT NOT NULL,
    "tcs_bps" INTEGER NOT NULL,
    "tds_bps" INTEGER NOT NULL,
    "commission_gst_bps" INTEGER NOT NULL,
    "rates_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "items" INTEGER NOT NULL DEFAULT 0,
    "issues" INTEGER NOT NULL DEFAULT 0,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_items" (
    "id" UUID NOT NULL,
    "entity_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "fee_paise" BIGINT NOT NULL,
    "tax_paise" BIGINT NOT NULL,
    "settled" BOOLEAN NOT NULL,
    "day" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_issues" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_rates_key_valid_from_idx" ON "finance_rates"("key", "valid_from");

-- CreateIndex
CREATE INDEX "settlement_batches_status_business_day_idx" ON "settlement_batches"("status", "business_day");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_batches_seller_id_business_day_key" ON "settlement_batches"("seller_id", "business_day");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_lines_order_id_key" ON "settlement_lines"("order_id");

-- CreateIndex
CREATE INDEX "settlement_lines_batch_id_idx" ON "settlement_lines"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_runs_day_key" ON "reconciliation_runs"("day");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_items_entity_id_key" ON "reconciliation_items"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_issues_kind_entity_id_key" ON "reconciliation_issues"("kind", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key_key" ON "ledger_transactions"("idempotency_key");

-- AddForeignKey
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════════ Hand-written (prompt 16) ═════════════

-- ── Balanced at commit: every transaction has ≥ 2 entries and debits = credits ──
CREATE FUNCTION ledger_check_balanced() RETURNS trigger AS $$
DECLARE
  tx uuid;
  n int;
  debits numeric;
  credits numeric;
BEGIN
  -- Separate branches: each table's row has only its own columns.
  IF TG_TABLE_NAME = 'ledger_transactions' THEN
    tx := NEW.id;
  ELSE
    tx := NEW.transaction_id;
  END IF;
  SELECT count(*),
         coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0),
         coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)
    INTO n, debits, credits
    FROM ledger_entries WHERE transaction_id = tx;
  IF n < 2 OR debits <> credits THEN
    RAISE EXCEPTION 'ledger transaction % is not balanced (% entries, debits %, credits %)', tx, n, debits, credits;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON "ledger_entries" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();
-- Also on the transaction itself, so a transaction with no entries can't commit either.
CREATE CONSTRAINT TRIGGER ledger_transactions_balanced
  AFTER INSERT ON "ledger_transactions" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- ── Append-only: transactions too (entries already are) ──
CREATE FUNCTION ledger_transactions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_transactions is append-only; post a reversing transaction instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_transactions_no_update_delete
  BEFORE UPDATE OR DELETE ON "ledger_transactions"
  FOR EACH ROW EXECUTE FUNCTION ledger_transactions_append_only();

-- ── Restricted app role: SELECT/INSERT only on ledger tables ──
-- The app connects as a LOGIN user that is a member of xatu_app (created at deploy time; never a
-- password in a migration: this repo is public). Migrations keep running as the owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xatu_app') THEN
    CREATE ROLE xatu_app NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO xatu_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO xatu_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO xatu_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "ledger_accounts", "ledger_transactions", "ledger_entries" FROM xatu_app;
-- Prisma's own bookkeeping is for migrations only.
REVOKE ALL ON "_prisma_migrations" FROM xatu_app;
-- Tables from future migrations (created by the same owner) get the normal grants automatically;
-- a future ledger table must REVOKE UPDATE/DELETE in its own migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO xatu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO xatu_app;

-- ── Platform accounts (created here, not only by the local seed) ──
INSERT INTO "ledger_accounts" ("id", "code", "name", "type", "created_at", "updated_at") VALUES
  (gen_random_uuid(), 'provider_clearing', 'Razorpay clearing (money at Razorpay)', 'asset', now(), now()),
  (gen_random_uuid(), 'customer_receipts', 'Buyer payments not yet allocated to an order', 'liability', now(), now()),
  (gen_random_uuid(), 'platform_commission', 'Platform commission revenue', 'revenue', now(), now()),
  (gen_random_uuid(), 'gst_on_commission_payable', 'GST on commission payable', 'liability', now(), now()),
  (gen_random_uuid(), 'gst_tcs_payable', 'GST TCS payable (Sec 52)', 'liability', now(), now()),
  (gen_random_uuid(), 'tds_194o_payable', 'TDS 194-O payable', 'liability', now(), now()),
  (gen_random_uuid(), 'gateway_fees', 'Payment gateway fees', 'expense', now(), now()),
  (gen_random_uuid(), 'gst_input_gateway', 'GST on gateway fees (input credit, CA to confirm)', 'asset', now(), now()),
  (gen_random_uuid(), 'bank', 'Xatu bank account', 'asset', now(), now())
ON CONFLICT ("code") DO NOTHING;

-- ── Dated finance rates (CA to confirm; change by adding a row, never by editing code) ──
INSERT INTO "finance_rates" ("id", "key", "rate_bps", "base", "note", "valid_from", "created_at", "updated_at") VALUES
  (gen_random_uuid(), 'tcs', 50, 'items_incl_gst', 'GST TCS Sec 52: 0.5% (0.25% CGST + 0.25% SGST) since 10 Jul 2024', '2024-07-10T00:00:00+05:30', now(), now()),
  (gen_random_uuid(), 'tds', 10, 'items_incl_gst', 'TDS 194-O: 0.1% since 1 Oct 2024', '2024-10-01T00:00:00+05:30', now(), now()),
  (gen_random_uuid(), 'commission_gst', 1800, 'commission', 'GST on Xatu commission: 18% (placeholder; CA to confirm)', '2024-07-01T00:00:00+05:30', now(), now());
ALTER TABLE "finance_rates" ADD CONSTRAINT "finance_rates_rate_check" CHECK ("rate_bps" BETWEEN 0 AND 10000);

-- ── Settlements and refunds: money CHECKs, one open automatic refund per payment ──
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_money_check" CHECK (
  "gross_paise" >= 0 AND "commission_paise" >= 0 AND "commission_gst_paise" >= 0 AND "tcs_paise" >= 0
  AND "tds_paise" >= 0 AND "net_paise" >= 0
  AND "net_paise" = "gross_paise" - "commission_paise" - "commission_gst_paise" - "tcs_paise" - "tds_paise");
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_money_check" CHECK (
  "gross_paise" = "items_paise" + "delivery_paise" AND "net_paise" >= 0
  AND "net_paise" = "gross_paise" - "commission_paise" - "commission_gst_paise" - "tcs_paise" - "tds_paise");
CREATE UNIQUE INDEX "refund_requests_one_open_per_payment" ON "refund_requests"("payment_id")
  WHERE "status" IN ('requested', 'approved', 'processing');
