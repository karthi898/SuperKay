-- CreateTable
CREATE TABLE "ProcessedEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ROUTINE',
    "summary" TEXT NOT NULL,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "confidence" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedEmail_messageId_key" ON "ProcessedEmail"("messageId");

-- CreateIndex
CREATE INDEX "ProcessedEmail_sender_idx" ON "ProcessedEmail"("sender");

-- CreateIndex
CREATE INDEX "ProcessedEmail_category_idx" ON "ProcessedEmail"("category");

-- CreateIndex
CREATE INDEX "ProcessedEmail_important_idx" ON "ProcessedEmail"("important");

-- CreateIndex
CREATE INDEX "ProcessedEmail_createdAt_idx" ON "ProcessedEmail"("createdAt");
