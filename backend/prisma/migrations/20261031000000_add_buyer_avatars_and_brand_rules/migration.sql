-- CreateTable
CREATE TABLE "BuyerAvatar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "who" TEXT NOT NULL,
    "primaryProblems" TEXT NOT NULL DEFAULT '[]',
    "unknownProblems" TEXT NOT NULL DEFAULT '[]',
    "mechanisms" TEXT NOT NULL DEFAULT '[]',
    "alternatives" TEXT NOT NULL DEFAULT '[]',
    "objections" TEXT NOT NULL DEFAULT '[]',
    "hooks" TEXT NOT NULL DEFAULT '[]',
    "creativeAngles" TEXT NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BuyerAvatar_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrandRules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "bannedPhrases" TEXT NOT NULL DEFAULT '[]',
    "requiredDisclosures" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandRules_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BuyerAvatar_businessId_sortOrder_idx" ON "BuyerAvatar"("businessId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BrandRules_businessId_key" ON "BrandRules"("businessId");
