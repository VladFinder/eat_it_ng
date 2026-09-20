ALTER TABLE "Household" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "Household" ADD COLUMN "subscriptionStatus" TEXT NOT NULL DEFAULT 'inactive';
ALTER TABLE "Household" ADD COLUMN "subscriptionProvider" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Household" ADD COLUMN "subscriptionPeriodEnd" DATETIME;
