-- AlterTable
ALTER TABLE "seller_profiles" ADD COLUMN     "approx_location" geography(Point, 4326);

-- CreateTable
CREATE TABLE "search_transliterations" (
    "id" UUID NOT NULL,
    "latin" TEXT NOT NULL,
    "tamil" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_transliterations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "search_transliterations_latin_tamil_key" ON "search_transliterations"("latin", "tamil");

-- CreateIndex
CREATE INDEX "products_title_ta_trgm_idx" ON "products" USING GIN ("title_ta" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_status_moderation_status_published_at_idx" ON "products"("status", "moderation_status", "published_at");

-- CreateIndex
CREATE INDEX "seller_profiles_approx_location_gist_idx" ON "seller_profiles" USING GIST ("approx_location");

-- Backfill: rounded public point (2 decimals, same as approximateLocation() in @xatu/shared).
UPDATE "seller_profiles"
SET "approx_location" = ST_SetSRID(ST_MakePoint(
      round(ST_X("location"::geometry)::numeric, 2)::float8,
      round(ST_Y("location"::geometry)::numeric, 2)::float8), 4326)::geography
WHERE "location" IS NOT NULL;

-- Starter list of Latin spellings for common Tamil product words. Add more without a deploy.
INSERT INTO "search_transliterations" ("id", "latin", "tamil") VALUES
  (gen_random_uuid(), 'murukku', 'முறுக்கு'),
  (gen_random_uuid(), 'muruku', 'முறுக்கு'),
  (gen_random_uuid(), 'murruku', 'முறுக்கு'),
  (gen_random_uuid(), 'adhirasam', 'அதிரசம்'),
  (gen_random_uuid(), 'athirasam', 'அதிரசம்'),
  (gen_random_uuid(), 'laddu', 'லட்டு'),
  (gen_random_uuid(), 'ladoo', 'லட்டு'),
  (gen_random_uuid(), 'ladu', 'லட்டு'),
  (gen_random_uuid(), 'halwa', 'அல்வா'),
  (gen_random_uuid(), 'alwa', 'அல்வா'),
  (gen_random_uuid(), 'mysore pak', 'மைசூர் பாக்'),
  (gen_random_uuid(), 'mysorepak', 'மைசூர் பாக்'),
  (gen_random_uuid(), 'seedai', 'சீடை'),
  (gen_random_uuid(), 'thattai', 'தட்டை'),
  (gen_random_uuid(), 'mixture', 'மிக்சர்'),
  (gen_random_uuid(), 'payasam', 'பாயசம்'),
  (gen_random_uuid(), 'kesari', 'கேசரி'),
  (gen_random_uuid(), 'sweet', 'இனிப்பு'),
  (gen_random_uuid(), 'inippu', 'இனிப்பு'),
  (gen_random_uuid(), 'cake', 'கேக்'),
  (gen_random_uuid(), 'cookies', 'குக்கீஸ்'),
  (gen_random_uuid(), 'biscuit', 'பிஸ்கட்'),
  (gen_random_uuid(), 'millet', 'சிறுதானியம்'),
  (gen_random_uuid(), 'siruthaniyam', 'சிறுதானியம்'),
  (gen_random_uuid(), 'ragi', 'கேழ்வரகு'),
  (gen_random_uuid(), 'kezhvaragu', 'கேழ்வரகு'),
  (gen_random_uuid(), 'pickle', 'ஊறுகாய்'),
  (gen_random_uuid(), 'oorugai', 'ஊறுகாய்'),
  (gen_random_uuid(), 'podi', 'பொடி'),
  (gen_random_uuid(), 'vadam', 'வடாம்'),
  (gen_random_uuid(), 'appalam', 'அப்பளம்'),
  (gen_random_uuid(), 'agal', 'அகல்'),
  (gen_random_uuid(), 'diya', 'அகல்'),
  (gen_random_uuid(), 'vilakku', 'விளக்கு'),
  (gen_random_uuid(), 'lamp', 'விளக்கு'),
  (gen_random_uuid(), 'paanai', 'பானை'),
  (gen_random_uuid(), 'panai', 'பானை'),
  (gen_random_uuid(), 'pot', 'பானை'),
  (gen_random_uuid(), 'mann', 'மண்'),
  (gen_random_uuid(), 'terracotta', 'சுடுமண்'),
  (gen_random_uuid(), 'sudumann', 'சுடுமண்'),
  (gen_random_uuid(), 'kolam', 'கோலம்'),
  (gen_random_uuid(), 'rangoli', 'கோலம்'),
  (gen_random_uuid(), 'maruthani', 'மருதாணி'),
  (gen_random_uuid(), 'marudhani', 'மருதாணி'),
  (gen_random_uuid(), 'henna', 'மருதாணி'),
  (gen_random_uuid(), 'mehndi', 'மருதாணி'),
  (gen_random_uuid(), 'malli', 'மல்லி'),
  (gen_random_uuid(), 'jasmine', 'மல்லி'),
  (gen_random_uuid(), 'poo', 'பூ'),
  (gen_random_uuid(), 'flower', 'பூ'),
  (gen_random_uuid(), 'maalai', 'மாலை'),
  (gen_random_uuid(), 'garland', 'மாலை'),
  (gen_random_uuid(), 'chedi', 'செடி'),
  (gen_random_uuid(), 'plant', 'செடி'),
  (gen_random_uuid(), 'thottam', 'தோட்டம்'),
  (gen_random_uuid(), 'thotti', 'தொட்டி'),
  (gen_random_uuid(), 'kammal', 'கம்மல்'),
  (gen_random_uuid(), 'jimikki', 'ஜிமிக்கி'),
  (gen_random_uuid(), 'jhumka', 'ஜிமிக்கி'),
  (gen_random_uuid(), 'valayal', 'வளையல்'),
  (gen_random_uuid(), 'bangle', 'வளையல்'),
  (gen_random_uuid(), 'kolusu', 'கொலுசு'),
  (gen_random_uuid(), 'anklet', 'கொலுசு'),
  (gen_random_uuid(), 'thodu', 'தோடு'),
  (gen_random_uuid(), 'saree', 'புடவை'),
  (gen_random_uuid(), 'pudavai', 'புடவை'),
  (gen_random_uuid(), 'kuthu vilakku', 'குத்து விளக்கு'),
  (gen_random_uuid(), 'kozhukattai', 'கொழுக்கட்டை'),
  (gen_random_uuid(), 'modak', 'கொழுக்கட்டை'),
  (gen_random_uuid(), 'murukku achu', 'முறுக்கு அச்சு')
ON CONFLICT ("latin", "tamil") DO NOTHING;

