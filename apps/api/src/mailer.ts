/**
 * Outgoing mail. Production: SMTP_URL (e.g. smtps://user:pass@mail.example.de) – a German provider (DSGVO).
 * Development: nothing leaves the machine; each mail is written as .eml into storage/outbox/.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const OUTBOX = fileURLToPath(new URL('../../../storage/outbox/', import.meta.url));

export interface Mail {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  text: string;
  attachments: { filename: string; content: Uint8Array }[];
}

export async function sendMail(mail: Mail): Promise<{ messageId: string; devFile?: string }> {
  const msg = { ...mail, attachments: mail.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: 'application/pdf' })) };
  if (process.env.SMTP_URL) {
    const info = await nodemailer.createTransport(process.env.SMTP_URL).sendMail(msg);
    return { messageId: info.messageId };
  }
  const info = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' }).sendMail(msg);
  await mkdir(OUTBOX, { recursive: true });
  const file = `${OUTBOX}${new Date().toISOString().replace(/[:.]/g, '-')}.eml`;
  await writeFile(file, info.message as Buffer);
  return { messageId: info.messageId, devFile: file };
}
