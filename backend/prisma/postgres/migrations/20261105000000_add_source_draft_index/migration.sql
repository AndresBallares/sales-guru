-- AlterTable
ALTER TABLE "BuyerAvatar" ADD COLUMN     "sourceDraftIndex" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "BuyerAvatar_sourceRunId_sourceDraftIndex_key" ON "BuyerAvatar"("sourceRunId", "sourceDraftIndex");
