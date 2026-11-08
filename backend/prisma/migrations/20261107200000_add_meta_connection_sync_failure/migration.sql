-- AlterTable
ALTER TABLE "MetaConnection" ADD COLUMN "syncFailedAt" DATETIME;
ALTER TABLE "MetaConnection" ADD COLUMN "syncFailureCode" INTEGER;
ALTER TABLE "MetaConnection" ADD COLUMN "syncFailureReason" TEXT;
ALTER TABLE "MetaConnection" ADD COLUMN "syncFailureSource" TEXT;
