interface DraftReplyParams {
    threadId: string;
    subject: string;
    to: string;
    replyText: string;
}
export declare function createGmailDraft({ threadId, subject, to, replyText, }: DraftReplyParams): Promise<string | null>;
export {};
//# sourceMappingURL=gmail.reply.d.ts.map