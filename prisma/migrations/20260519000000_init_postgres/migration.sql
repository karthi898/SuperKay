-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileSession" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileSession_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "ProcessedEmail" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ROUTINE',
    "summary" TEXT NOT NULL,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slackChannelId" TEXT,
    "slackMessageTs" TEXT,
    "alertSentAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "escalationStatus" TEXT NOT NULL DEFAULT 'NOT_NEEDED',
    "autoReplySent" BOOLEAN NOT NULL DEFAULT false,
    "autoReplyAt" TIMESTAMP(3),
    "fromName" TEXT,
    "fromEmail" TEXT,
    "subjectSummary" TEXT,
    "bodySummary" TEXT,
    "userId" TEXT,

    CONSTRAINT "ProcessedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "MobileSession_userId_idx" ON "MobileSession"("userId");

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

-- CreateIndex
CREATE INDEX "ProcessedEmail_escalationStatus_idx" ON "ProcessedEmail"("escalationStatus");

-- CreateIndex
CREATE INDEX "ProcessedEmail_slackMessageTs_idx" ON "ProcessedEmail"("slackMessageTs");

-- CreateIndex
CREATE INDEX "ProcessedEmail_userId_idx" ON "ProcessedEmail"("userId");

-- AddForeignKey
ALTER TABLE "MobileSession" ADD CONSTRAINT "MobileSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedEmail" ADD CONSTRAINT "ProcessedEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
