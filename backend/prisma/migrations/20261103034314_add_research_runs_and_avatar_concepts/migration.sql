-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT,
    "depth" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "maxSearches" INTEGER NOT NULL,
    "maxFetches" INTEGER NOT NULL,
    "maxCostUsd" REAL NOT NULL,
    "searchesUsed" INTEGER NOT NULL DEFAULT 0,
    "fetchesUsed" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "promptVersion" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "productIds" TEXT NOT NULL DEFAULT '[]',
    "extraCompetitorUrls" TEXT NOT NULL DEFAULT '[]',
    "findings" TEXT NOT NULL DEFAULT '{}',
    "coverageNote" TEXT,
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "heartbeatAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "BuyerAvatar" ADD COLUMN "concepts" TEXT NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "ResearchRun_businessId_createdAt_idx" ON "ResearchRun"("businessId", "createdAt");
