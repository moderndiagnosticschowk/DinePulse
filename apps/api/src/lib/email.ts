import { Resend } from 'resend';
import { env } from './env.js';

let resendClient: Resend | null = null;

function getResendClient() {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  resendClient ??= new Resend(env.RESEND_API_KEY);
  return resendClient;
}

export async function sendDinePulseEmail(input: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}) {
  const resend = getResendClient();

  const { data, error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...(input.text ? { text: input.text } : {}),
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export function isEmailConfigured() {
  return Boolean(env.RESEND_API_KEY);
}