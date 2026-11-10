-- Media pipeline (prompt 10). cover_media_key was never populated, so it is replaced by a link to media_assets.
-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('shop_cover', 'product_photo');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('pending', 'processing', 'ready', 'rejected');

-- AlterTable
ALTER TABLE "seller_profiles" DROP COLUMN "cover_media_key",
ADD COLUMN     "cover_media_id" UUID;

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'pending',
    "upload_key" TEXT NOT NULL,
    "storage_key" TEXT,
    "declared_type" TEXT NOT NULL,
    "declared_bytes" INTEGER NOT NULL,
    "content_type" TEXT,
    "byte_size" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "blurhash" TEXT,
    "captured_in_app" BOOLEAN NOT NULL DEFAULT false,
    "reject_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ready_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_upload_key_key" ON "media_assets"("upload_key");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storage_key_key" ON "media_assets"("storage_key");

-- CreateIndex
CREATE INDEX "media_assets_owner_id_created_at_idx" ON "media_assets"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "media_assets_status_created_at_idx" ON "media_assets"("status", "created_at");

-- AddForeignKey
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Sizes are positive and uploads are capped at 10 MB (also enforced in the API).
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_declared_bytes_check" CHECK ("declared_bytes" > 0 AND "declared_bytes" <= 10485760);
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_dimensions_check" CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0));
