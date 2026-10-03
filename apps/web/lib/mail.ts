/**
 * Transactional email for OTP codes, verification and password resets (FR-61, FR-69).
 *
 * Two modes, chosen by whether `RESEND_API_KEY` is set:
 *   - **development**: the message is printed to the server console and the code is returned to the
 *     caller so the UI can display it. Nobody has to own a mail domain to run this project locally.
 *   - **production**: sent through Resend's HTTP API (free tier), with no SDK — it is one `fetch`.
 *
 * `devCode` is returned **only** when there is no mail provider configured, so a deployed instance
 * can never leak a code back to the browser.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailResult {
  delivered: 'console' | 'resend';
  /** Present only in development, for the UI to show. */
  devCode?: string;
}

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendMail(message: MailMessage, devCode?: string): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.info(
      `\n──── email (development: not actually sent) ────\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n───────────────────────────────────────────────\n`,
    );
    return devCode === undefined ? { delivered: 'console' } : { delivered: 'console', devCode };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM ?? 'DepLens <onboarding@resend.dev>',
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
  });
  if (!res.ok) {
    // Surfaced to the caller: a sign-up that silently sends no code is worse than a visible failure.
    throw new Error(`Email provider rejected the message (${res.status}): ${await res.text()}`);
  }
  return { delivered: 'resend' };
}

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export function verificationEmail(to: string, code: string): MailMessage {
  return {
    to,
    subject: `${code} is your DepLens verification code`,
    text: [
      'Welcome to DepLens.',
      '',
      `Your verification code is: ${code}`,
      '',
      'It expires in 10 minutes and can be used once.',
      `Enter it at ${appUrl()}/verify`,
      '',
      'If you did not create this account, you can ignore this message.',
    ].join('\n'),
  };
}

export function resetEmail(to: string, token: string): MailMessage {
  return {
    to,
    subject: 'Reset your DepLens password',
    text: [
      'Someone asked to reset the password for this DepLens account.',
      '',
      `Open this link within 30 minutes: ${appUrl()}/reset?token=${encodeURIComponent(token)}`,
      '',
      'The link works once. Using it signs out every device.',
      'If this was not you, no action is needed — your password has not changed.',
    ].join('\n'),
  };
}
