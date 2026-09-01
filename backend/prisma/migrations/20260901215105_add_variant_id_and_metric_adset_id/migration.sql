-- AlterTable
ALTER TABLE "AdSet" ADD COLUMN "variantId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Metric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "adSetId" TEXT,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "spend" REAL NOT NULL,
    "conversions" INTEGER NOT NULL,
    "reach" INTEGER,
    "cpm" REAL,
    "ctr" REAL,
    "cpc" REAL,
    "landingPageViews" INTEGER,
    "addToCart" INTEGER,
    "addToCartRate" REAL,
    "conversionRate" REAL,
    "cac" REAL,
    "purchaseValue" REAL,
    "roas" REAL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Metric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Metric_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "AdSet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Metric" ("addToCart", "addToCartRate", "cac", "campaignId", "clicks", "conversionRate", "conversions", "cpc", "cpm", "ctr", "fetchedAt", "id", "impressions", "landingPageViews", "purchaseValue", "reach", "roas", "spend") SELECT "addToCart", "addToCartRate", "cac", "campaignId", "clicks", "conversionRate", "conversions", "cpc", "cpm", "ctr", "fetchedAt", "id", "impressions", "landingPageViews", "purchaseValue", "reach", "roas", "spend" FROM "Metric";
DROP TABLE "Metric";
ALTER TABLE "new_Metric" RENAME TO "Metric";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
