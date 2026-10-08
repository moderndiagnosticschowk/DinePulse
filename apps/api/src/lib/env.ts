import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().email().default('onboarding@resend.dev'),
});

export const env = schema.parse(process.env);