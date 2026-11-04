-- AlterTable
ALTER TABLE "BuyerAvatar" ADD COLUMN "sourceRunId" TEXT;

-- AlterTable
ALTER TABLE "ResearchRun" ADD COLUMN "reviewedAt" DATETIME;

-- CreateIndex
CREATE INDEX "BuyerAvatar_sourceRunId_idx" ON "BuyerAvatar"("sourceRunId");
