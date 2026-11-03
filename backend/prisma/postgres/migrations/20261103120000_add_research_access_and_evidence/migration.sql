-- AlterTable
ALTER TABLE "Business" ADD COLUMN "allowedResearchModels" TEXT NOT NULL DEFAULT '["claude-opus-5-5"]';
ALTER TABLE "Business" ADD COLUMN "researchRunsPerMonth" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ResearchRun" ADD COLUMN "stopReason" TEXT;
ALTER TABLE "ResearchRun" ADD COLUMN "customerVoiceSources" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ResearchRun" ADD COLUMN "evidenceLevel" TEXT;
ALTER TABLE "ResearchRun" ADD COLUMN "evidenceReason" TEXT;
