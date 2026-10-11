ALTER TABLE "Dish" ADD COLUMN "mealTypes" TEXT NOT NULL DEFAULT '[]';

UPDATE "Dish" SET "mealTypes" = '["breakfast"]' WHERE "id" = 'catalog-dish-omelet-cheese';
UPDATE "Dish" SET "mealTypes" = '["lunch","dinner"]' WHERE "id" IN ('catalog-dish-chicken-rice', 'catalog-dish-vegetable-pasta');
UPDATE "Dish" SET "mealTypes" = '["breakfast","dessert"]' WHERE "id" = 'catalog-dish-cottage-cheese-pancakes';
