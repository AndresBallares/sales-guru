-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN     "offer" TEXT,
ADD COLUMN     "proofPoints" TEXT;

-- AlterTable
ALTER TABLE "Creative" ALTER COLUMN "description" DROP NOT NULL;
