import { and, eq, messageLog, messagingOptins, otpChallenges, sql, type Db, type MessageStatus } from '@repo/db';

export interface MessageLogInput {
  channel: 'whatsapp' | 'sms';
  category: 'authentication' | 'utility' | 'marketing';
  template: string;
  templateVersion: number;
  language: string;
  toPhone: string;
  userId?: string | null;
  purpose: string;
  providerMessageId?: string | null;
  status: MessageStatus;
  errorCode?: string | null;
  fallbackOf?: string | null;
}

export interface OptinInput {
  phone: string;
  channel: 'whatsapp' | 'sms';
  status: 'opted_in' | 'opted_out';
  source: 'signin' | 'profile' | 'stop_reply' | 'console';
  consentVersion?: string | null;
}

export interface MessagingRepo {
  logMessage(row: MessageLogInput): Promise<{ id: string }>;
  /** Applies a provider status; never moves backwards (e.g. read → delivered). Returns the row id if found. */
  updateStatus(providerMessageId: string, status: MessageStatus, errorCode?: string | null): Promise<{ id: string } | null>;
  recordOptin(row: OptinInput): Promise<void>;
  recordOtpChallenge(row: { phoneHash: string; channel: 'whatsapp' | 'sms'; outcome: 'sent' | 'fallback_sms' | 'rate_limited' | 'failed' }): Promise<void>;
}

export const statusRank: Record<MessageStatus, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

const rankSql = sql`case ${messageLog.status} when 'queued' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 4 end`;

export function drizzleMessagingRepo(db: Db): MessagingRepo {
  return {
    async logMessage(row) {
      const [r] = await db.insert(messageLog).values(row).returning({ id: messageLog.id });
      return { id: r!.id };
    },
    async updateStatus(providerMessageId, status, errorCode) {
      const [updated] = await db
        .update(messageLog)
        .set({ status, errorCode: errorCode ?? null })
        .where(and(eq(messageLog.providerMessageId, providerMessageId), sql`${rankSql} < ${statusRank[status]}`))
        .returning({ id: messageLog.id });
      if (updated) return updated;
      const [existing] = await db.select({ id: messageLog.id }).from(messageLog).where(eq(messageLog.providerMessageId, providerMessageId));
      return existing ?? null;
    },
    async recordOptin(row) {
      await db.insert(messagingOptins).values(row);
    },
    async recordOtpChallenge(row) {
      await db.insert(otpChallenges).values(row);
    },
  };
}
