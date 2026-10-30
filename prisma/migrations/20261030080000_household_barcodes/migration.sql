CREATE TABLE "HouseholdBarcodeProduct" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "householdId" TEXT NOT NULL,
  "barcode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'products',
  "unit" TEXT NOT NULL DEFAULT 'шт.',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "HouseholdBarcodeProduct_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "HouseholdBarcodeProduct_householdId_barcode_key" ON "HouseholdBarcodeProduct"("householdId", "barcode");
