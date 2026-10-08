import { Router } from 'express';
import { isEmailConfigured } from '../lib/email.js';
import { env } from '../lib/env.js';

export const emailRouter = Router();

emailRouter.get('/status', (_req, res) => {
  res.json({
    success: true,
    data: {
      provider: 'resend',
      configured: isEmailConfigured(),
      from: env.EMAIL_FROM,
      mode: env.EMAIL_FROM === 'onboarding@resend.dev' ? 'test' : 'custom-domain',
    },
  });
});