import { NormalizedMessage } from '../types/message.types';
export declare function fetchUnreadEmails(): Promise<NormalizedMessage[]>;
export declare function markAsProcessed(messageId: string): Promise<void>;
//# sourceMappingURL=gmail.poller.d.ts.map