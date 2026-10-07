import express from 'express';
import { z } from 'zod';
import cors from 'cors';
import { env } from './lib/env.js';
import { healthRouter } from './routes/health.js';
import { meRouter } from './routes/me.js';
import { menuRouter } from './routes/menu.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: env.CORS_ORIGIN, credentials: false }));
app.use(express.json({ limit: '256kb' }));

app.get('/api/v1', (_req, res) => res.json({ success: true, data: { name: 'Smart Restaurant POS API', version: 'v1' } }));
app.use('/api/v1/health', healthRouter);
app.use('/api/v1/me', meRouter);
app.use('/api/v1/menu', menuRouter);

app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found', code: 'NOT_FOUND' }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ success: false, message: 'Validation failed', code: 'VALIDATION_ERROR', data: error.flatten() });
  }
  console.error(error);
  return res.status(500).json({ success: false, message: 'Internal server error', code: 'INTERNAL_ERROR' });
});

app.listen(env.PORT, () => console.log(`API listening on http://localhost:${env.PORT}`));
