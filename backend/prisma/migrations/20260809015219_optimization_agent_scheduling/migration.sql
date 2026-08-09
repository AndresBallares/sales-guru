/*
  Warnings:

  - Added the required column `confidence` to the `OptimizationRecommendation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `risk` to the `OptimizationRecommendation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "lastOptimizationCheckAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OptimizationRecommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetAdId" TEXT,
    "currentBudget" REAL,
    "suggestedBudget" REAL,
    "reasoning" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "risk" TEXT NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OptimizationRecommendation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_OptimizationRecommendation" ("actionType", "campaignId", "createdAt", "currentBudget", "id", "reasoning", "status", "suggestedBudget", "targetAdId", "updatedAt") SELECT "actionType", "campaignId", "createdAt", "currentBudget", "id", "reasoning", "status", "suggestedBudget", "targetAdId", "updatedAt" FROM "OptimizationRecommendation";
DROP TABLE "OptimizationRecommendation";
ALTER TABLE "new_OptimizationRecommendation" RENAME TO "OptimizationRecommendation";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
