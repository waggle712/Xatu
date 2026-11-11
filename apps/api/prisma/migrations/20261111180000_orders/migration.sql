-- Prompt 14: cart, stock holds and order creation.
-- Hand-edited: the order status enum is mapped from the old values, and the idempotency table and
-- shipping column are renamed (not dropped), so no existing row is lost.

-- ── Order status: the lifecycle in CLAUDE.md ──
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('draft', 'awaiting_payment', 'placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'expired', 'cancelled_by_buyer', 'cancelled_by_seller', 'in_dispute', 'refunded', 'partially_refunded');
ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "status" TYPE "OrderStatus_new" USING (
  CASE "status"::text
    WHEN 'pending_payment' THEN 'awaiting_payment'
    WHEN 'paid' THEN 'placed'
    WHEN 'shipped' THEN 'out_for_delivery'
    WHEN 'delivered' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled_by_buyer'
    ELSE "status"::text
  END::"OrderStatus_new");
ALTER TABLE "order_events" ALTER COLUMN "from_status" TYPE "OrderStatus_new" USING (
  CASE "from_status"::text
    WHEN 'pending_payment' THEN 'awaiting_payment'
    WHEN 'paid' THEN 'placed'
    WHEN 'shipped' THEN 'out_for_delivery'
    WHEN 'delivered' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled_by_buyer'
    ELSE "from_status"::text
  END::"OrderStatus_new");
ALTER TABLE "order_events" ALTER COLUMN "to_status" TYPE "OrderStatus_new" USING (
  CASE "to_status"::text
    WHEN 'pending_payment' THEN 'awaiting_payment'
    WHEN 'paid' THEN 'placed'
    WHEN 'shipped' THEN 'out_for_delivery'
    WHEN 'delivered' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled_by_buyer'
    ELSE "to_status"::text
  END::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "OrderStatus_old";
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'awaiting_payment';
COMMIT;

-- ── idempotency_keys → idempotency_records (rename, keep rows) ──
ALTER TABLE "idempotency_keys" RENAME TO "idempotency_records";
ALTER TABLE "idempotency_records" RENAME CONSTRAINT "idempotency_keys_pkey" TO "idempotency_records_pkey";
ALTER TABLE "idempotency_records" RENAME CONSTRAINT "idempotency_keys_user_id_fkey" TO "idempotency_records_user_id_fkey";
ALTER INDEX "idempotency_keys_user_id_endpoint_key_key" RENAME TO "idempotency_records_user_id_endpoint_key_key";

-- ── Orders ──
ALTER TABLE "orders" RENAME COLUMN "shipping_paise" TO "delivery_fee_paise";
ALTER TABLE "orders" ADD COLUMN "commission_paise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "expires_at" TIMESTAMP(3);
CREATE INDEX "orders_status_expires_at_idx" ON "orders"("status", "expires_at");
ALTER TABLE "orders" ADD CONSTRAINT "orders_money_check" CHECK (
  "subtotal_paise" >= 0 AND "delivery_fee_paise" >= 0 AND "commission_paise" >= 0
  AND "total_paise" = "subtotal_paise" + "delivery_fee_paise");
ALTER TABLE "orders" ADD CONSTRAINT "orders_expires_check" CHECK (
  "status" <> 'awaiting_payment' OR "expires_at" IS NOT NULL);

ALTER TABLE "order_items" ADD COLUMN "commission_paise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "line_total_paise" BIGINT,
ADD COLUMN "title_ta_snapshot" TEXT;
UPDATE "order_items" SET "line_total_paise" = "unit_price_paise" * "quantity";
ALTER TABLE "order_items" ALTER COLUMN "line_total_paise" SET NOT NULL;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_money_check" CHECK (
  "quantity" > 0 AND "unit_price_paise" >= 0 AND "commission_paise" >= 0
  AND "line_total_paise" = "unit_price_paise" * "quantity"
  AND "commission_bps" BETWEEN 0 AND 10000);

-- (inventory_reservations already has a quantity > 0 CHECK from the init migration.)
-- Fast "units held right now" per variant.
CREATE INDEX "inventory_reservations_active_idx" ON "inventory_reservations"("variant_id", "expires_at") WHERE "status" = 'active';

-- ── Shops: flat local-delivery fee ──
ALTER TABLE "seller_profiles" ADD COLUMN "local_delivery_fee_paise" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_delivery_fee_check" CHECK (
  "local_delivery_fee_paise" BETWEEN 0 AND 100000);

-- ── Addresses ──
ALTER TABLE "addresses" ADD COLUMN "landmark" TEXT;

-- ── Bag (one maker at a time) ──
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cart_items_quantity_check" CHECK ("quantity" BETWEEN 1 AND 20)
);
CREATE UNIQUE INDEX "carts_user_id_key" ON "carts"("user_id");
CREATE UNIQUE INDEX "cart_items_cart_id_variant_id_key" ON "cart_items"("cart_id", "variant_id");
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Commission: 0% default until the CA confirms the rate (decided 11 Nov 2026) ──
-- The latest default rule wins, so this replaces any earlier default without editing it.
INSERT INTO "commission_rules" ("id", "name", "category_id", "rate_bps", "valid_from", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'Pilot default 0% (until CA confirms)', NULL, 0, '2026-11-11T00:00:00+05:30', now(), now());
-- (commission_rules already has a rate CHECK from the init migration.)
