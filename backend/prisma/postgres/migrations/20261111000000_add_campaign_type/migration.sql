-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "campaignType" TEXT;

-- Backfill (app/services/campaign_type.py's backfill_campaign_type): type every
-- campaign that already has a strategy from its plan shape and budget level.
-- A campaign with no strategy stays null. Re-running changes nothing.
UPDATE "Campaign" SET "campaignType" = 'CREATIVE_TEST'
WHERE "campaignType" IS NULL
  AND EXISTS (SELECT 1 FROM "Strategy" s WHERE s."campaignId" = "Campaign"."id"
              AND s."content" LIKE '%"planType":"CREATIVE_TEST_PLAN"%');

UPDATE "Campaign" SET "campaignType" = 'STANDARD'
WHERE "campaignType" IS NULL AND "budgetLevel" = 'AD_SET'
  AND EXISTS (SELECT 1 FROM "Strategy" s WHERE s."campaignId" = "Campaign"."id"
              AND s."content" LIKE '%"planType":"DATA_DRIVEN_STRATEGY"%');

UPDATE "Campaign" SET "campaignType" = 'DATA_DRIVEN'
WHERE "campaignType" IS NULL AND "budgetLevel" = 'CAMPAIGN'
  AND EXISTS (SELECT 1 FROM "Strategy" s WHERE s."campaignId" = "Campaign"."id"
              AND s."content" LIKE '%"planType":"DATA_DRIVEN_STRATEGY"%');

UPDATE "Campaign" SET "campaignType" = 'LEGACY_AUDIENCE_TEST'
WHERE "campaignType" IS NULL
  AND EXISTS (SELECT 1 FROM "Strategy" s WHERE s."campaignId" = "Campaign"."id"
              AND s."content" LIKE '%"planType":"TEST_PLAN"%');
