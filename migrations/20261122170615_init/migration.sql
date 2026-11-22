-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transcript" JSONB NOT NULL DEFAULT [],
    "slides" JSONB NOT NULL DEFAULT [],
    "openQuestions" JSONB NOT NULL DEFAULT [],
    "email" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft'
);
