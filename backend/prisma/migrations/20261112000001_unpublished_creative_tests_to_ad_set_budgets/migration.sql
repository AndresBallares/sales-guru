-- Creative-test campaigns that were never published still carry a campaign budget
-- (the old plan shape). Nothing of theirs exists on Meta, so give them the ad-set
-- rounds structure now; a published campaign is never touched. Re-running changes
-- nothing: a plan that already says roundsBudget is skipped.
UPDATE "Strategy"
SET "content" = replace(
      "content",
      '"planType":"CREATIVE_TEST_PLAN"',
      '"planType":"CREATIVE_TEST_PLAN","roundsBudget":"AD_SET"')
WHERE "content" LIKE '%"planType":"CREATIVE_TEST_PLAN"%'
  AND "content" NOT LIKE '%"roundsBudget"%'
  AND "campaignId" IN (
    SELECT "id" FROM "Campaign"
    WHERE "metaCampaignId" IS NULL AND "budgetLevel" = 'CAMPAIGN');

UPDATE "Campaign" SET "budgetLevel" = 'AD_SET'
WHERE "metaCampaignId" IS NULL
  AND "budgetLevel" = 'CAMPAIGN'
  AND EXISTS (SELECT 1 FROM "Strategy" s WHERE s."campaignId" = "Campaign"."id"
              AND s."content" LIKE '%"planType":"CREATIVE_TEST_PLAN"%'
              AND s."content" LIKE '%"roundsBudget":"AD_SET"%');
