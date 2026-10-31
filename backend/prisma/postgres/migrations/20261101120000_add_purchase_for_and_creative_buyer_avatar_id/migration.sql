-- AlterTable
ALTER TABLE "BuyerAvatar" ADD COLUMN "purchaseFor" TEXT NOT NULL DEFAULT 'self';

-- AlterTable
ALTER TABLE "Creative" ADD COLUMN "buyerAvatarId" TEXT;
