export interface SlackAlertParams {
    from: string;
    subject: string;
    priority: number;
    reason: string;
    summary: string;
    threadId: string;
}
export declare function sendSlackAlert({ from, subject, priority, reason, summary, threadId, }: SlackAlertParams): Promise<void>;
//# sourceMappingURL=slack.notify.d.ts.map