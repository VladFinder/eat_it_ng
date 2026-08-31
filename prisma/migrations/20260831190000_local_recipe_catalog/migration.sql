CREATE TABLE "Product" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "aliases" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Product_normalizedName_key" ON "Product"("normalizedName");

CREATE TABLE "Dish" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "description" TEXT,
  "instructions" TEXT,
  "source" TEXT NOT NULL DEFAULT 'local',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "Dish_source_title_idx" ON "Dish"("source", "title");

CREATE TABLE "DishIngredient" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "dishId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" REAL,
  "unit" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT true,
  FOREIGN KEY ("dishId") REFERENCES "Dish" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "DishIngredient_dishId_productId_key" ON "DishIngredient"("dishId", "productId");
CREATE INDEX "DishIngredient_productId_idx" ON "DishIngredient"("productId");
