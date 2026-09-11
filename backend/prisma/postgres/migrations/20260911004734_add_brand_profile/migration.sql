-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "idealCustomer" TEXT NOT NULL,
    "voiceTraits" TEXT NOT NULL,
    "brandPhrases" TEXT,
    "avoidPhrases" TEXT,
    "pricePositioning" TEXT NOT NULL,
    "tagline" TEXT,
    "competitors" TEXT,
    "exampleCopy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_businessId_key" ON "BrandProfile"("businessId");

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
