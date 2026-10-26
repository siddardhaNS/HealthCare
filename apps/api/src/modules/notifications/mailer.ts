/**
 * Outbound email. The provider isn't chosen yet (needs your approval: it's a
 * paid service), so only the log transport exists. Emails never carry health
 * data; lead alerts carry a reference and a console link, not contact details.
 */
export interface Mailer {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

export function logMailer(): Mailer {
  return {
    async send(msg) {
      console.info(`[mail:log] to=${msg.to.replace(/^(.).*@/, '$1***@')} subject="${msg.subject}"`);
    },
  };
}
