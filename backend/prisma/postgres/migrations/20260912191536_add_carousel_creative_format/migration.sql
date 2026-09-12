-- AlterTable
ALTER TABLE "Creative" ADD COLUMN     "format" TEXT NOT NULL DEFAULT 'SINGLE_IMAGE';

-- CreateTable
CREATE TABLE "CreativeCard" (
    "id" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "productImageId" TEXT,
    "headline" TEXT NOT NULL,
    "description" TEXT,
    "linkUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeCard_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CreativeCard" ADD CONSTRAINT "CreativeCard_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
