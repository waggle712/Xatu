-- Catalog (prompt 11): product variants hold price and stock, product photos point at media
-- assets, append-only stock movements, and every paise column becomes BIGINT.
-- Hand-edited: existing products get one default variant carrying their price and stock
-- BEFORE the product columns are dropped.

-- CreateEnum
CREATE TYPE "StockMovementReason" AS ENUM ('listing_created', 'seller_set', 'order_sold', 'order_cancelled', 'admin_correction');

-- Money is BIGINT paise everywhere.
ALTER TABLE "ledger_entries" ALTER COLUMN "amount_paise" SET DATA TYPE BIGINT;
ALTER TABLE "orders" ALTER COLUMN "subtotal_paise" SET DATA TYPE BIGINT,
ALTER COLUMN "shipping_paise" SET DATA TYPE BIGINT,
ALTER COLUMN "total_paise" SET DATA TYPE BIGINT;
ALTER TABLE "payments" ALTER COLUMN "amount_paise" SET DATA TYPE BIGINT;
ALTER TABLE "refund_requests" ALTER COLUMN "amount_paise" SET DATA TYPE BIGINT;
ALTER TABLE "order_items" ALTER COLUMN "unit_price_paise" SET DATA TYPE BIGINT;

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "label" TEXT,
    "label_ta" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "price_paise" BIGINT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_variants_price_positive" CHECK ("price_paise" > 0 AND "price_paise" <= 100000000),
    CONSTRAINT "product_variants_stock_nonnegative" CHECK ("stock" >= 0 AND "stock" <= 100000),
    CONSTRAINT "product_variants_position_range" CHECK ("position" BETWEEN 0 AND 19)
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "stock_after" INTEGER NOT NULL,
    "reason" "StockMovementReason" NOT NULL,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_movements_stock_after_nonnegative" CHECK ("stock_after" >= 0)
);

-- Backfill: one default variant per existing product, with its price and stock.
INSERT INTO "product_variants" ("id", "product_id", "price_paise", "stock", "position", "updated_at")
SELECT gen_random_uuid(), "id", "price_paise", "stock", 0, CURRENT_TIMESTAMP FROM "products";

INSERT INTO "stock_movements" ("id", "variant_id", "delta", "stock_after", "reason")
SELECT gen_random_uuid(), "id", "stock", "stock", 'listing_created' FROM "product_variants";

-- Products: price and stock now live on variants.
ALTER TABLE "products" ALTER COLUMN "title" DROP NOT NULL,
DROP COLUMN "price_paise",
DROP COLUMN "stock",
ADD COLUMN     "lead_time_days" INTEGER,
ADD COLUMN     "made_to_order" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "published_at" TIMESTAMP(3),
-- Lead time only for made-to-order products; publishing also requires it (checked in the service,
-- because an autosaved draft may be made-to-order before the seller types the days).
ADD CONSTRAINT "products_lead_time" CHECK (
  "lead_time_days" IS NULL OR ("made_to_order" = true AND "lead_time_days" BETWEEN 1 AND 60)
);

-- Products that were already live count as published when they were created.
UPDATE "products" SET "published_at" = "created_at"
WHERE "status" = 'active' AND "moderation_status" = 'live';

-- Product photos point at media assets (no rows exist yet).
DROP INDEX "product_media_product_id_position_idx";
ALTER TABLE "product_media" DROP COLUMN "captured_in_app",
DROP COLUMN "height",
DROP COLUMN "storage_key",
DROP COLUMN "width",
ADD COLUMN     "media_id" UUID NOT NULL,
ALTER COLUMN "position" DROP DEFAULT,
ADD CONSTRAINT "product_media_position_range" CHECK ("position" BETWEEN 0 AND 7);

-- Reservations and order items name the variant (both tables are empty before this migration).
ALTER TABLE "inventory_reservations" ADD COLUMN     "variant_id" UUID NOT NULL;
ALTER TABLE "order_items" ADD COLUMN     "variant_id" UUID NOT NULL,
ADD COLUMN     "variant_snapshot" TEXT;

-- CreateIndex
CREATE INDEX "product_variants_product_id_position_idx" ON "product_variants"("product_id", "position");
CREATE INDEX "stock_movements_variant_id_created_at_idx" ON "stock_movements"("variant_id", "created_at");
CREATE INDEX "inventory_reservations_variant_id_status_idx" ON "inventory_reservations"("variant_id", "status");
CREATE UNIQUE INDEX "product_media_media_id_key" ON "product_media"("media_id");
CREATE UNIQUE INDEX "product_media_product_id_position_key" ON "product_media"("product_id", "position");

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- stock_movements is append-only: no UPDATE or DELETE, ever.
CREATE FUNCTION "stock_movements_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only';
END;
$$;
CREATE TRIGGER "stock_movements_no_update_delete"
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "stock_movements_append_only"();
