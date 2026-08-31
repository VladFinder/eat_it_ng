ALTER TABLE "Dish" ADD COLUMN "householdId" TEXT;
ALTER TABLE "Dish" ADD COLUMN "imageUrl" TEXT;

CREATE INDEX "Dish_householdId_updatedAt_idx" ON "Dish"("householdId", "updatedAt");
