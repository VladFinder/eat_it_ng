CREATE TABLE "MealPlanEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "householdId" TEXT NOT NULL,
  "dishId" TEXT NOT NULL,
  "date" DATETIME NOT NULL,
  "mealType" TEXT NOT NULL DEFAULT 'dinner',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE,
  FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "MealPlanEntry_householdId_date_mealType_key"
ON "MealPlanEntry"("householdId", "date", "mealType");

CREATE INDEX "MealPlanEntry_householdId_date_idx"
ON "MealPlanEntry"("householdId", "date");

CREATE INDEX "MealPlanEntry_dishId_idx" ON "MealPlanEntry"("dishId");
