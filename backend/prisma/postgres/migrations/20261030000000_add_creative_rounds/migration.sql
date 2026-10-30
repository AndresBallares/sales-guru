-- AlterTable
ALTER TABLE "Creative" ADD COLUMN     "roundId" TEXT;

-- CreateTable
CREATE TABLE "CreativeRound" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "generatedCount" INTEGER NOT NULL,
    "selectedCount" INTEGER NOT NULL DEFAULT 0,
    "angles" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreativeRound_campaignId_number_key" ON "CreativeRound"("campaignId", "number");

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CreativeRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeRound" ADD CONSTRAINT "CreativeRound_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
