-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TestEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "winningVariant" TEXT,
    "confidence" TEXT NOT NULL,
    "hypothesisResult" TEXT NOT NULL,
    "keyFindings" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "stopReason" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestEvaluation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TestEvaluation" ("campaignId", "confidence", "createdAt", "hypothesisResult", "id", "keyFindings", "reasoning", "recommendedAction", "status", "winningVariant") SELECT "campaignId", "confidence", "createdAt", "hypothesisResult", "id", "keyFindings", "reasoning", "recommendedAction", "status", "winningVariant" FROM "TestEvaluation";
DROP TABLE "TestEvaluation";
ALTER TABLE "new_TestEvaluation" RENAME TO "TestEvaluation";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
