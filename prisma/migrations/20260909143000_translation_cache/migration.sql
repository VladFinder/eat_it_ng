CREATE TABLE "TranslationCache" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceLanguage" TEXT NOT NULL,
  "targetLanguage" TEXT NOT NULL,
  "sourceText" TEXT NOT NULL,
  "translatedText" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "TranslationCache_sourceLanguage_targetLanguage_sourceText_key"
ON "TranslationCache"("sourceLanguage", "targetLanguage", "sourceText");

CREATE INDEX "TranslationCache_targetLanguage_updatedAt_idx"
ON "TranslationCache"("targetLanguage", "updatedAt");
