-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "aspectClass" TEXT,
ADD COLUMN     "durationSeconds" DOUBLE PRECISION,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "mediaType" TEXT NOT NULL DEFAULT 'IMAGE',
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "thumbnailContentType" TEXT,
ADD COLUMN     "thumbnailData" BYTEA,
ADD COLUMN     "width" INTEGER;
