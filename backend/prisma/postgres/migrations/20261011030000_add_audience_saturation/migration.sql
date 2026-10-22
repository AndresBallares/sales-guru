-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "saturationCheckedAt" TIMESTAMP(3),
ADD COLUMN     "saturationStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "saturationWarning" TEXT;

-- AlterTable
ALTER TABLE "Metric" ADD COLUMN     "frequency" DOUBLE PRECISION,
ADD COLUMN     "frequency7d" DOUBLE PRECISION,
ADD COLUMN     "reach7d" INTEGER;
