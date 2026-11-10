-- Seller onboarding (prompt 9). Written by hand so existing rows keep their data.

CREATE TYPE "SellerStatus" AS ENUM ('draft', 'kyc_pending', 'active', 'paused', 'suspended');

-- bio becomes the English story; a Tamil story is added.
ALTER TABLE "seller_profiles" RENAME COLUMN "bio" TO "story_en";

ALTER TABLE "seller_profiles"
  ADD COLUMN "story_ta" TEXT,
  ADD COLUMN "area_name" TEXT,
  ADD COLUMN "pickup_address_line" TEXT,
  ADD COLUMN "pickup_landmark" TEXT,
  ADD COLUMN "opening_hours" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "cover_media_key" TEXT,
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ALTER COLUMN "pincode" DROP NOT NULL;

-- status: AccountStatus (active/suspended) -> SellerStatus, keeping each shop's state.
ALTER TABLE "seller_profiles" ADD COLUMN "status_new" "SellerStatus" NOT NULL DEFAULT 'draft';
UPDATE "seller_profiles"
  SET "status_new" = CASE "status"::text WHEN 'suspended' THEN 'suspended'::"SellerStatus" ELSE 'active'::"SellerStatus" END;
DROP INDEX IF EXISTS "seller_profiles_city_status_idx";
ALTER TABLE "seller_profiles" DROP COLUMN "status";
ALTER TABLE "seller_profiles" RENAME COLUMN "status_new" TO "status";
CREATE INDEX "seller_profiles_city_status_idx" ON "seller_profiles"("city", "status");
