import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { requireBranch, type BranchRequest } from '../middleware/branch.js';
import { createUserClient } from '../lib/supabase.js';

export const menuRouter = Router();
menuRouter.use(requireAuth, requireBranch);

const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  image_url: z.string().url().optional().nullable(),
  sort_order: z.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});

const modifierSchema = z.object({
  name: z.string().trim().min(1).max(80),
  price: z.number().min(0).default(0),
  is_active: z.boolean().default(true),
});

const itemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  category_id: z.string().uuid().optional().nullable(),
  sku: z.string().trim().max(50).optional().nullable(),
  price: z.number().min(0),
  cost_price: z.number().min(0).optional().nullable(),
  tax_rate: z.number().min(0).max(100).default(0),
  image_url: z.string().url().optional().nullable(),
  is_veg: z.boolean().default(false),
  is_available: z.boolean().default(true),
  is_active: z.boolean().default(true),
  modifier_ids: z.array(z.string().uuid()).default([]),
});

async function canManage(r: BranchRequest) {
  const supabase = createUserClient(r.accessToken);
  const { data, error } = await supabase
    .from('branch_memberships')
    .select('role')
    .eq('branch_id', r.branchId)
    .eq('user_id', r.user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return !!data && ['OWNER','ADMIN','MANAGER'].includes(data.role);
}

menuRouter.get('/categories', async (req, res, next) => {
  try {
    const r = req as BranchRequest;
    const supabase = createUserClient(r.accessToken);
    const { data, error } = await supabase.from('categories').select('*').eq('branch_id', r.branchId).order('sort_order').order('name');
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

menuRouter.post('/categories', async (req, res, next) => {
  try {
    const r = req as BranchRequest;
    if (!(await canManage(r))) return res.status(403).json({ success:false,message:'Manager permission required',code:'FORBIDDEN' });
    const body = categorySchema.parse(req.body);
    const supabase = createUserClient(r.accessToken);
    const { data, error } = await supabase.from('categories').insert({ ...body, branch_id: r.branchId }).select('*').single();
    if (error) return res.status(400).json({ success:false,message:error.message,code:'CATEGORY_CREATE_FAILED' });
    res.status(201).json({ success:true,data });
  } catch (error) { next(error); }
});

menuRouter.patch('/categories/:id', async (req, res, next) => {
  try {
    const r = req as BranchRequest;
    if (!(await canManage(r))) return res.status(403).json({ success:false,message:'Manager permission required',code:'FORBIDDEN' });
    const id = z.string().uuid().parse(req.params.id);
    const body = categorySchema.partial().parse(req.body);
    const supabase = createUserClient(r.accessToken);
    const { data, error } = await supabase.from('categories').update(body).eq('id', id).eq('branch_id', r.branchId).select('*').single();
    if (error) return res.status(400).json({ success:false,message:error.message,code:'CATEGORY_UPDATE_FAILED' });
    res.json({ success:true,data });
  } catch (error) { next(error); }
});

menuRouter.delete('/categories/:id', async (req, res, next) => {
  try {
    const r = req as BranchRequest;
    if (!(await canManage(r))) return res.status(403).json({ success:false,message:'Manager permission required',code:'FORBIDDEN' });
    const id = z.string().uuid().parse(req.params.id);
    const supabase = createUserClient(r.accessToken);
    const { error } = await supabase.from('categories').delete().eq('id', id).eq('branch_id', r.branchId);
    if (error) return res.status(400).json({ success:false,message:error.message,code:'CATEGORY_DELETE_FAILED' });
    res.json({ success:true,data:null });
  } catch (error) { next(error); }
});

menuRouter.get('/modifiers', async (req, res, next) => {
  try {
    const r = req as BranchRequest;
    const supabase = createUserClient(r.accessToken);
    const { data, error } = await supabase.from('modifiers').select('*').eq('branch_id', r.branchId).order('name');
    if (error) throw error;
    res.json({ success:true,data });
  } catch (error) { next(error); }
});

menuRouter.post('/modifiers', async (req, res, next) => {
  try {
    const r = req as BranchRequest;
    if (!(await canManage(r))) return res.status(403).json({ success:false,message:'Manager permission required',code:'FORBIDDEN' });
    const body = modifierSchema.parse(req.body);
    const supabase = createUserClient(r.accessToken);
    const { data, error } = await supabase.from('modifiers').insert({ ...body, branch_id: r.branchId }).select('*').single();
    if (error) return res.status(400).json({ success:false,message:error.message,code:'MODIFIER_CREATE_FAILED' });
    res.status(201).json({ success:true,data });
  } catch (error) { next(error); }
});

menuRouter.patch('/modifiers/:id', async (req, res, next) => {
  try {
    const r = req as BranchRequest;
    if (!(await canManage(r))) return res.status(403).json({ success:false,message:'Manager permission required',code:'FORBIDDEN' });
    const id = z.string().uuid().parse(req.params.id);
    const body = modifierSchema.partial().parse(req.body);
    const supabase = createUserClient(r.accessToken);
    const { data, error } = await supabase.from('modifiers').update(body).eq('id', id).eq('branch_id', r.branchId).select('*').single();
    if (error) return res.status(400).json({ success:false,message:error.message,code:'MODIFIER_UPDATE_FAILED' });
    res.json({ success:true,data });
  } catch (error) { next(error); }
});

menuRouter.delete('/modifiers/:id', async (req, res, next) => {
  try {
    const r = req as BranchRequest;
    if (!(await canManage(r))) return res.status(403).json({ success:false,message:'Manager permission required',code:'FORBIDDEN' });
    const id = z.string().uuid().parse(req.params.id);
    const supabase = createUserClient(r.accessToken);
    const { error } = await supabase.from('modifiers').delete().eq('id', id).eq('branch_id', r.branchId);
    if (error) return res.status(400).json({ success:false,message:error.message,code:'MODIFIER_DELETE_FAILED' });
    res.json({ success:true,data:null });
  } catch (error) { next(error); }
});

menuRouter.get('/items', async (req, res, next) => {
  try {
    const r = req as BranchRequest;
    const supabase = createUserClient(r.accessToken);
    const { data, error } = await supabase
      .from('menu_items')
      .select('*,categories(id,name),menu_item_modifiers(modifier_id,modifiers(id,name,price))')
      .eq('branch_id', r.branchId)
      .order('is_active', { ascending:false })
      .order('name');
    if (error) throw error;
    res.json({ success:true,data });
  } catch (error) { next(error); }
});

menuRouter.post('/items', async (req, res, next) => {
  try {
    const r = req as BranchRequest;
    if (!(await canManage(r))) return res.status(403).json({ success:false,message:'Manager permission required',code:'FORBIDDEN' });
    const body = itemSchema.parse(req.body);
    const modifierIds = body.modifier_ids;
    const { modifier_ids: _ignore, ...item } = body;
    const supabase = createUserClient(r.accessToken);
    const { data, error } = await supabase.from('menu_items').insert({ ...item, branch_id: r.branchId }).select('*').single();
    if (error) return res.status(400).json({ success:false,message:error.message,code:'MENU_ITEM_CREATE_FAILED' });
    if (modifierIds.length) {
      const rows = modifierIds.map(modifier_id => ({ menu_item_id: data.id, modifier_id }));
      const { error: modifierError } = await supabase.from('menu_item_modifiers').insert(rows);
      if (modifierError) return res.status(400).json({ success:false,message:modifierError.message,code:'MENU_ITEM_MODIFIERS_FAILED' });
    }
    res.status(201).json({ success:true,data });
  } catch (error) { next(error); }
});

menuRouter.patch('/items/:id', async (req, res, next) => {
  try {
    const r = req as BranchRequest;
    if (!(await canManage(r))) return res.status(403).json({ success:false,message:'Manager permission required',code:'FORBIDDEN' });
    const id = z.string().uuid().parse(req.params.id);
    const body = itemSchema.partial().parse(req.body);
    const modifierIds = body.modifier_ids;
    const { modifier_ids: _ignore, ...item } = body;
    const supabase = createUserClient(r.accessToken);
    const { data, error } = await supabase.from('menu_items').update(item).eq('id', id).eq('branch_id', r.branchId).select('*').single();
    if (error) return res.status(400).json({ success:false,message:error.message,code:'MENU_ITEM_UPDATE_FAILED' });
    if (modifierIds) {
      await supabase.from('menu_item_modifiers').delete().eq('menu_item_id', id);
      if (modifierIds.length) {
        const { error: modifierError } = await supabase.from('menu_item_modifiers').insert(modifierIds.map(modifier_id => ({ menu_item_id:id,modifier_id })));
        if (modifierError) return res.status(400).json({ success:false,message:modifierError.message,code:'MENU_ITEM_MODIFIERS_FAILED' });
      }
    }
    res.json({ success:true,data });
  } catch (error) { next(error); }
});

menuRouter.delete('/items/:id', async (req, res, next) => {
  try {
    const r = req as BranchRequest;
    if (!(await canManage(r))) return res.status(403).json({ success:false,message:'Manager permission required',code:'FORBIDDEN' });
    const id = z.string().uuid().parse(req.params.id);
    const supabase = createUserClient(r.accessToken);
    const { error } = await supabase.from('menu_items').delete().eq('id', id).eq('branch_id', r.branchId);
    if (error) return res.status(400).json({ success:false,message:error.message,code:'MENU_ITEM_DELETE_FAILED' });
    res.json({ success:true,data:null });
  } catch (error) { next(error); }
});
