-- AlterTable
ALTER TABLE "BuyerAvatar" ADD COLUMN     "concepts" TEXT NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT,
    "depth" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "maxSearches" INTEGER NOT NULL,
    "maxFetches" INTEGER NOT NULL,
    "maxCostUsd" DOUBLE PRECISION NOT NULL,
    "searchesUsed" INTEGER NOT NULL DEFAULT 0,
    "fetchesUsed" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "promptVersion" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "productIds" TEXT NOT NULL DEFAULT '[]',
    "extraCompetitorUrls" TEXT NOT NULL DEFAULT '[]',
    "findings" TEXT NOT NULL DEFAULT '{}',
    "coverageNote" TEXT,
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchRun_businessId_createdAt_idx" ON "ResearchRun"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
