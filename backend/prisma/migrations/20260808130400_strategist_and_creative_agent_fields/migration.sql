/*
  Warnings:

  - You are about to drop the column `budgetRecommendation` on the `Strategy` table. All the data in the column will be lost.
  - You are about to drop the column `rationale` on the `Strategy` table. All the data in the column will be lost.
  - You are about to drop the column `targeting` on the `Strategy` table. All the data in the column will be lost.
  - Added the required column `cta` to the `Creative` table without a default value. This is not possible if the table is not empty.
  - Added the required column `description` to the `Creative` table without a default value. This is not possible if the table is not empty.
  - Added the required column `content` to the `Strategy` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "name" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Creative" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "creativeAngle" TEXT,
    "imagePrompt" TEXT,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "metaCreativeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Creative_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Creative" ("adId", "bodyText", "createdAt", "headline", "id", "imageUrl", "metaCreativeId", "status", "updatedAt") SELECT "adId", "bodyText", "createdAt", "headline", "id", "imageUrl", "metaCreativeId", "status", "updatedAt" FROM "Creative";
DROP TABLE "Creative";
ALTER TABLE "new_Creative" RENAME TO "Creative";
CREATE TABLE "new_Strategy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Strategy_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Strategy" ("campaignId", "createdAt", "id") SELECT "campaignId", "createdAt", "id" FROM "Strategy";
DROP TABLE "Strategy";
ALTER TABLE "new_Strategy" RENAME TO "Strategy";
CREATE UNIQUE INDEX "Strategy_campaignId_key" ON "Strategy"("campaignId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
