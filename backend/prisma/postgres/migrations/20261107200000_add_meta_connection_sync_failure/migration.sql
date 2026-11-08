-- AlterTable
ALTER TABLE "MetaConnection" ADD COLUMN     "syncFailedAt" TIMESTAMP(3),
ADD COLUMN     "syncFailureCode" INTEGER,
ADD COLUMN     "syncFailureReason" TEXT,
ADD COLUMN     "syncFailureSource" TEXT;
