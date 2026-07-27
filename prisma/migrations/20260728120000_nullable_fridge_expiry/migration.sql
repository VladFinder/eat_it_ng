PRAGMA foreign_keys=OFF;

CREATE TABLE "new_FridgeItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "householdId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "quantity" REAL NOT NULL,
  "unit" TEXT NOT NULL,
  "expiresAt" DATETIME,
  "reminderDays" INTEGER NOT NULL DEFAULT 1,
  "category" TEXT NOT NULL DEFAULT 'products',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "FridgeItem_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_FridgeItem" ("category", "createdAt", "expiresAt", "householdId", "id", "name", "quantity", "reminderDays", "unit", "updatedAt")
SELECT "category", "createdAt", "expiresAt", "householdId", "id", "name", "quantity", "reminderDays", "unit", "updatedAt"
FROM "FridgeItem";

DROP TABLE "FridgeItem";
ALTER TABLE "new_FridgeItem" RENAME TO "FridgeItem";
CREATE INDEX "FridgeItem_householdId_idx" ON "FridgeItem"("householdId");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
