-- AlterTable
ALTER TABLE "AdSet" ADD COLUMN "endDate" TIMESTAMP(3);
ALTER TABLE "AdSet" ADD COLUMN "isWinners" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CreativeRound" ADD COLUMN "winnerCreativeIds" TEXT;
ALTER TABLE "Creative" ADD COLUMN "carriedFromCreativeId" TEXT;
ALTER TABLE "Creative" ADD COLUMN "carriedFromRound" INTEGER;
