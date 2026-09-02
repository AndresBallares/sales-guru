/*
  Warnings:

  - You are about to drop the column `url` on the `ProductImage` table. All the data in the column will be lost.
  - Added the required column `contentType` to the `ProductImage` table without a default value. This is not possible if the table is not empty.
  - Added the required column `data` to the `ProductImage` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProductImage" ("createdAt", "id", "productId") SELECT "createdAt", "id", "productId" FROM "ProductImage";
DROP TABLE "ProductImage";
ALTER TABLE "new_ProductImage" RENAME TO "ProductImage";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
