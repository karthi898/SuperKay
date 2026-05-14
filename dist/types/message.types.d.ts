export interface NormalizedMessage {
    channel: 'gmail';
    messageId: string;
    threadId: string;
    sender: string;
    subject: string;
    body: string;
    timestamp: string;
}
export interface ClassificationResult {
    important: boolean;
    priority: number;
    category: 'IMPORTANT' | 'ROUTINE' | 'NOISE';
    summary: string;
    reason: string;
    reply_needed: boolean;
    draft_reply: string | null;
    confidence: number;
}
export interface ProcessedEmail {
    messageId: string;
    threadId: string;
    sender: string;
    subject: string;
    body: string;
    classification: ClassificationResult;
    processedAt: Date;
}
//# sourceMappingURL=message.types.d.ts.map