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
  contextType?: string | null;
  contextId?: string | null;
}

/** A WhatsApp message about something that has not reached the person yet (no SMS sent for it either). */
export interface UndeliveredMessage {
  id: string;
  toPhone: string;
  template: string;
  language: string;
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
  /** WhatsApp messages for this context and purpose not delivered or read, with no SMS sent for them yet. */
  undelivered(context: { type: string; id: string }, purpose: string): Promise<UndeliveredMessage[]>;
  /** Whether any message for this context and purpose was already sent (so a retried step sends nothing twice). */
  anySent(context: { type: string; id: string }, purpose: string): Promise<boolean>;
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
    async anySent(context, purpose) {
      const [r] = await db
        .select({ id: messageLog.id })
        .from(messageLog)
        .where(and(eq(messageLog.contextType, context.type), eq(messageLog.contextId, context.id), eq(messageLog.purpose, purpose)))
        .limit(1);
      return !!r;
    },
    async undelivered(context, purpose) {
      return db
        .select({ id: messageLog.id, toPhone: messageLog.toPhone, template: messageLog.template, language: messageLog.language })
        .from(messageLog)
        .where(
          and(
            eq(messageLog.contextType, context.type),
            eq(messageLog.contextId, context.id),
            eq(messageLog.purpose, purpose),
            eq(messageLog.channel, 'whatsapp'),
            sql`${messageLog.status} in ('queued', 'sent', 'failed')`,
            sql`not exists (select 1 from message_log f where f.fallback_of = ${messageLog.id})`,
          ),
        );
    },
  };
}
