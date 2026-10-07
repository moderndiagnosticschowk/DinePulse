import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { createUserClient } from '../lib/supabase.js';

export const meRouter = Router();

meRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const r = req as AuthenticatedRequest;
    const supabase = createUserClient(r.accessToken);
    const [{ data: profile, error: profileError }, { data: memberships, error: membershipsError }] = await Promise.all([
      supabase.from('profiles').select('id,full_name,phone,is_active').eq('id', r.user.id).maybeSingle(),
      supabase.from('branch_memberships').select('id,branch_id,role,is_active,branches(id,name,code,company_id)').eq('user_id', r.user.id).eq('is_active', true),
    ]);
    if (profileError) throw profileError;
    if (membershipsError) throw membershipsError;
    res.json({ success: true, data: { user: r.user, profile, memberships } });
  } catch (error) {
    next(error);
  }
});
