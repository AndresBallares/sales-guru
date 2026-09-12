-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN "offer" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "proofPoints" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Creative" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "adId" TEXT,
    "headline" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "description" TEXT,
    "cta" TEXT NOT NULL,
    "creativeAngle" TEXT,
    "imagePrompt" TEXT,
    "videoPrompt" TEXT,
    "imageUrl" TEXT,
    "productImageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "metaCreativeId" TEXT,
    "sourceProductId" TEXT,
    "sourceDescription" TEXT,
    "sourceUrl" TEXT,
    "sourceBusinessDescription" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Creative_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Creative_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Creative" ("adId", "bodyText", "campaignId", "createdAt", "creativeAngle", "cta", "description", "headline", "id", "imagePrompt", "imageUrl", "metaCreativeId", "productImageId", "sourceBusinessDescription", "sourceDescription", "sourceProductId", "sourceUrl", "status", "updatedAt", "videoPrompt") SELECT "adId", "bodyText", "campaignId", "createdAt", "creativeAngle", "cta", "description", "headline", "id", "imagePrompt", "imageUrl", "metaCreativeId", "productImageId", "sourceBusinessDescription", "sourceDescription", "sourceProductId", "sourceUrl", "status", "updatedAt", "videoPrompt" FROM "Creative";
DROP TABLE "Creative";
ALTER TABLE "new_Creative" RENAME TO "Creative";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
