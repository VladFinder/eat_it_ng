ALTER TABLE "Dish" ADD COLUMN "externalId" TEXT;

CREATE UNIQUE INDEX "Dish_source_externalId_key" ON "Dish"("source", "externalId");
