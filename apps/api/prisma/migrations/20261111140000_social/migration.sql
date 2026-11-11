-- CreateTable
CREATE TABLE "shop_follows" (
    "user_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_follows_pkey" PRIMARY KEY ("user_id","seller_id")
);

-- CreateTable
CREATE TABLE "saved_products" (
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_products_pkey" PRIMARY KEY ("user_id","product_id")
);

-- CreateIndex
CREATE INDEX "shop_follows_user_id_created_at_idx" ON "shop_follows"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "shop_follows_seller_id_idx" ON "shop_follows"("seller_id");

-- CreateIndex
CREATE INDEX "saved_products_user_id_created_at_idx" ON "saved_products"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "saved_products_product_id_idx" ON "saved_products"("product_id");

-- AddForeignKey
ALTER TABLE "shop_follows" ADD CONSTRAINT "shop_follows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_follows" ADD CONSTRAINT "shop_follows_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_products" ADD CONSTRAINT "saved_products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_products" ADD CONSTRAINT "saved_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-written: reports (prompt 13) ──

-- One open report per reporter and target. A second report while the first is still open or
-- being reviewed is the same report; once it is closed (actioned or dismissed) they may report
-- again.
CREATE UNIQUE INDEX "reports_one_open_per_target" ON "reports"("reporter_id", "target_type", "target_id")
  WHERE "status" IN ('open', 'reviewing');

-- The reason list and details limit match createReportSchema in @xatu/shared.
ALTER TABLE "reports" ADD CONSTRAINT "reports_reason_check"
  CHECK ("reason" IN ('counterfeit', 'prohibited', 'misleading', 'unsafe', 'offensive', 'scam', 'other'));
ALTER TABLE "reports" ADD CONSTRAINT "reports_details_length_check"
  CHECK ("details" IS NULL OR char_length("details") <= 500);
