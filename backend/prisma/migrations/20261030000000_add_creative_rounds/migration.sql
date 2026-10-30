-- CreateTable
CREATE TABLE "CreativeRound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "generatedCount" INTEGER NOT NULL,
    "selectedCount" INTEGER NOT NULL DEFAULT 0,
    "angles" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreativeRound_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Creative" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "roundId" TEXT,
    "adId" TEXT,
    "headline" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "description" TEXT,
    "cta" TEXT NOT NULL,
    "creativeAngle" TEXT,
    "avatar" TEXT,
    "concept" TEXT,
    "pillar" TEXT,
    "imagePrompt" TEXT,
    "videoPrompt" TEXT,
    "imageUrl" TEXT,
    "productImageId" TEXT,
    "storyProductImageId" TEXT,
    "squareProductImageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "metaCreativeId" TEXT,
    "sourceProductId" TEXT,
    "sourceDescription" TEXT,
    "sourceUrl" TEXT,
    "sourcePersonalization" TEXT,
    "sourceBusinessDescription" TEXT,
    "format" TEXT NOT NULL DEFAULT 'SINGLE_IMAGE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Creative_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Creative_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CreativeRound" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Creative_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Creative" ("adId", "avatar", "bodyText", "campaignId", "concept", "createdAt", "creativeAngle", "cta", "description", "format", "headline", "id", "imagePrompt", "imageUrl", "metaCreativeId", "pillar", "productImageId", "sourceBusinessDescription", "sourceDescription", "sourcePersonalization", "sourceProductId", "sourceUrl", "squareProductImageId", "status", "storyProductImageId", "updatedAt", "videoPrompt") SELECT "adId", "avatar", "bodyText", "campaignId", "concept", "createdAt", "creativeAngle", "cta", "description", "format", "headline", "id", "imagePrompt", "imageUrl", "metaCreativeId", "pillar", "productImageId", "sourceBusinessDescription", "sourceDescription", "sourcePersonalization", "sourceProductId", "sourceUrl", "squareProductImageId", "status", "storyProductImageId", "updatedAt", "videoPrompt" FROM "Creative";
DROP TABLE "Creative";
ALTER TABLE "new_Creative" RENAME TO "Creative";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CreativeRound_campaignId_number_key" ON "CreativeRound"("campaignId", "number");
