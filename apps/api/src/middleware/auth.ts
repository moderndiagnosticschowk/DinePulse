import type { NextFunction, Request, Response } from 'express';
import { createUserClient } from '../lib/supabase.js';

export type AuthenticatedRequest = Request & {
  user: { id: string; email?: string };
  accessToken: string;
};

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.header('authorization');
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Authentication required', code: 'UNAUTHENTICATED' });
    const accessToken = auth.slice('Bearer '.length);
    const supabase = createUserClient(accessToken);
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) return res.status(401).json({ success: false, message: 'Invalid or expired session', code: 'INVALID_SESSION' });
    (req as AuthenticatedRequest).user = { id: data.user.id, email: data.user.email };
    (req as AuthenticatedRequest).accessToken = accessToken;
    next();
  } catch (error) {
    next(error);
  }
}
