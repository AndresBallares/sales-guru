-- CreateTable
CREATE TABLE "MetaOAuthState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MetaConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "metaUserId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "adAccountId" TEXT,
    "pageId" TEXT,
    "tokenExpiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MetaConnection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MetaConnection" ("accessToken", "adAccountId", "businessId", "createdAt", "id", "metaUserId", "pageId", "tokenExpiresAt", "updatedAt") SELECT "accessToken", "adAccountId", "businessId", "createdAt", "id", "metaUserId", "pageId", "tokenExpiresAt", "updatedAt" FROM "MetaConnection";
DROP TABLE "MetaConnection";
ALTER TABLE "new_MetaConnection" RENAME TO "MetaConnection";
CREATE UNIQUE INDEX "MetaConnection_businessId_key" ON "MetaConnection"("businessId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
