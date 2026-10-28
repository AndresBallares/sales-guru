-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "personalizable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "personalizationOptions" TEXT;
