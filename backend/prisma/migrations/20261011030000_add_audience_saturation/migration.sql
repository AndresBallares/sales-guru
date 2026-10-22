-- AlterTable
ALTER TABLE "Metric" ADD COLUMN "frequency" REAL;
ALTER TABLE "Metric" ADD COLUMN "reach7d" INTEGER;
ALTER TABLE "Metric" ADD COLUMN "frequency7d" REAL;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "saturationStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Campaign" ADD COLUMN "saturationCheckedAt" DATETIME;
ALTER TABLE "Campaign" ADD COLUMN "saturationWarning" TEXT;
