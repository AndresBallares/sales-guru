-- AlterTable
ALTER TABLE "Metric" ADD COLUMN "addToCart" INTEGER;
ALTER TABLE "Metric" ADD COLUMN "addToCartRate" REAL;
ALTER TABLE "Metric" ADD COLUMN "cac" REAL;
ALTER TABLE "Metric" ADD COLUMN "cpc" REAL;
ALTER TABLE "Metric" ADD COLUMN "cpm" REAL;
ALTER TABLE "Metric" ADD COLUMN "ctr" REAL;
ALTER TABLE "Metric" ADD COLUMN "landingPageViews" INTEGER;
ALTER TABLE "Metric" ADD COLUMN "purchaseValue" REAL;
ALTER TABLE "Metric" ADD COLUMN "reach" INTEGER;
ALTER TABLE "Metric" ADD COLUMN "roas" REAL;

-- CreateTable
CREATE TABLE "TestEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "winningVariant" TEXT,
    "confidence" TEXT NOT NULL,
    "hypothesisResult" TEXT NOT NULL,
    "keyFindings" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestEvaluation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
