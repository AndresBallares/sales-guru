-- AlterTable
ALTER TABLE "Product" ADD COLUMN "personalizable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "personalizationOptions" TEXT;
