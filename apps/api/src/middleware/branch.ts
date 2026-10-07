import type { NextFunction, Request, Response } from 'express';
import { createUserClient } from '../lib/supabase.js';
import type { AuthenticatedRequest } from './auth.js';

export type BranchRequest = AuthenticatedRequest & { branchId: string };

export async function requireBranch(req: Request, res: Response, next: NextFunction) {
  try {
    const branchId = req.header('x-branch-id');
    const r = req as BranchRequest;
    if (!branchId) return res.status(400).json({ success: false, message: 'X-Branch-Id header is required', code: 'BRANCH_REQUIRED' });
    const supabase = createUserClient(r.accessToken);
    const { data, error } = await supabase
      .from('branch_memberships')
      .select('branch_id,role,is_active')
      .eq('branch_id', branchId)
      .eq('user_id', r.user.id)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(403).json({ success: false, message: 'You do not have access to this branch', code: 'BRANCH_FORBIDDEN' });
    r.branchId = branchId;
    next();
  } catch (error) {
    next(error);
  }
}
