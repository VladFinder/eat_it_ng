ALTER TABLE "Dish" ADD COLUMN "originalTitle" TEXT;
ALTER TABLE "Dish" ADD COLUMN "originalDescription" TEXT;
ALTER TABLE "Dish" ADD COLUMN "originalInstructions" TEXT;
ALTER TABLE "Dish" ADD COLUMN "translationStatus" TEXT NOT NULL DEFAULT 'original';
ALTER TABLE "Dish" ADD COLUMN "detailsFetched" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "originalName" TEXT;
ALTER TABLE "Product" ADD COLUMN "translationStatus" TEXT NOT NULL DEFAULT 'original';
CREATE TABLE "ProviderRecipePage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recipeIds" TEXT NOT NULL,
  "nextOffset" INTEGER,
  "limited" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
