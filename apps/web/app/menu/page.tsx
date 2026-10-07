'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

type Membership = { id:string; role:string; branches:{id:string;name:string;code:string|null;company_id:string}|null };
type Me = { success:boolean; data:{ memberships:Membership[] } };
type Category = { id:string; name:string; description:string|null; sort_order:number; is_active:boolean };
type Modifier = { id:string; name:string; price:number; is_active:boolean };
type Item = { id:string; name:string; description:string|null; category_id:string|null; sku:string|null; price:number; cost_price:number|null; tax_rate:number; is_veg:boolean; is_available:boolean; is_active:boolean; categories:{id:string;name:string}|null; menu_item_modifiers:Array<{modifier_id:string;modifiers:Modifier|null}> };

const input='mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-slate-400';
const button='rounded-xl px-3.5 py-2.5 text-sm font-bold transition disabled:opacity-50';

export default function MenuPage(){
  const [branchId,setBranchId]=useState('');
  const [membership,setMembership]=useState<Membership|null>(null);
  const [categories,setCategories]=useState<Category[]>([]);
  const [modifiers,setModifiers]=useState<Modifier[]>([]);
  const [items,setItems]=useState<Item[]>([]);
  const [tab,setTab]=useState<'items'|'categories'|'modifiers'>('items');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [categoryName,setCategoryName]=useState('');
  const [editingCategory,setEditingCategory]=useState<Category|null>(null);
  const [modifierName,setModifierName]=useState('');
  const [modifierPrice,setModifierPrice]=useState('0');
  const [editingModifier,setEditingModifier]=useState<Modifier|null>(null);
  const [editingItem,setEditingItem]=useState<Item|null>(null);
  const [itemForm,setItemForm]=useState({name:'',description:'',category_id:'',sku:'',price:'',cost_price:'',tax_rate:'0',is_veg:false,is_available:true,is_active:true,modifier_ids:[] as string[]});
  const activeCategories=useMemo(()=>categories.filter(c=>c.is_active),[categories]);

  function flashError(e:unknown){setError(e instanceof Error?e.message:'Something went wrong');setMessage('');}
  function flashMessage(value:string){setMessage(value);setError('');}

  async function loadAll(selectedBranch=branchId){
    if(!selectedBranch)return;
    const headers={'X-Branch-Id':selectedBranch};
    const [c,m,i]=await Promise.all([
      apiFetch<{success:boolean;data:Category[]}>('/api/v1/menu/categories',{headers}),
      apiFetch<{success:boolean;data:Modifier[]}>('/api/v1/menu/modifiers',{headers}),
      apiFetch<{success:boolean;data:Item[]}>('/api/v1/menu/items',{headers}),
    ]);
    setCategories(c.data); setModifiers(m.data); setItems(i.data);
  }

  useEffect(()=>{(async()=>{try{const me=await apiFetch<Me>('/api/v1/me');const first=me.data.memberships[0]??null;setMembership(first);if(first?.branches?.id){setBranchId(first.branches.id);await loadAll(first.branches.id)}}catch(e){flashError(e)}})()},[]);

  function resetItem(){setEditingItem(null);setItemForm({name:'',description:'',category_id:'',sku:'',price:'',cost_price:'',tax_rate:'0',is_veg:false,is_available:true,is_active:true,modifier_ids:[]});}
  function resetCategory(){setEditingCategory(null);setCategoryName('');}
  function resetModifier(){setEditingModifier(null);setModifierName('');setModifierPrice('0');}

  async function saveCategory(e:FormEvent){e.preventDefault();setBusy(true);try{const body={name:categoryName,sort_order:editingCategory?.sort_order??categories.length*10,is_active:true};if(editingCategory)await apiFetch(`/api/v1/menu/categories/${editingCategory.id}`,{method:'PATCH',headers:{'X-Branch-Id':branchId},body:JSON.stringify(body)});else await apiFetch('/api/v1/menu/categories',{method:'POST',headers:{'X-Branch-Id':branchId},body:JSON.stringify(body)});resetCategory();await loadAll();flashMessage(editingCategory?'Category updated':'Category added')}catch(e){flashError(e)}finally{setBusy(false)}}
  async function removeCategory(id:string){if(!confirm('Delete this category? Items in it will become Uncategorized.'))return;setBusy(true);try{await apiFetch(`/api/v1/menu/categories/${id}`,{method:'DELETE',headers:{'X-Branch-Id':branchId}});await loadAll();flashMessage('Category deleted')}catch(e){flashError(e)}finally{setBusy(false)}}
  async function saveModifier(e:FormEvent){e.preventDefault();setBusy(true);try{const body={name:modifierName,price:Number(modifierPrice),is_active:true};if(editingModifier)await apiFetch(`/api/v1/menu/modifiers/${editingModifier.id}`,{method:'PATCH',headers:{'X-Branch-Id':branchId},body:JSON.stringify(body)});else await apiFetch('/api/v1/menu/modifiers',{method:'POST',headers:{'X-Branch-Id':branchId},body:JSON.stringify(body)});resetModifier();await loadAll();flashMessage(editingModifier?'Modifier updated':'Modifier added')}catch(e){flashError(e)}finally{setBusy(false)}}
  async function removeModifier(id:string){if(!confirm('Delete this modifier?'))return;setBusy(true);try{await apiFetch(`/api/v1/menu/modifiers/${id}`,{method:'DELETE',headers:{'X-Branch-Id':branchId}});await loadAll();flashMessage('Modifier deleted')}catch(e){flashError(e)}finally{setBusy(false)}}
  async function saveItem(e:FormEvent){e.preventDefault();setBusy(true);try{const payload={...itemForm,price:Number(itemForm.price),cost_price:itemForm.cost_price===''?null:Number(itemForm.cost_price),tax_rate:Number(itemForm.tax_rate),category_id:itemForm.category_id||null};if(editingItem)await apiFetch(`/api/v1/menu/items/${editingItem.id}`,{method:'PATCH',headers:{'X-Branch-Id':branchId},body:JSON.stringify(payload)});else await apiFetch('/api/v1/menu/items',{method:'POST',headers:{'X-Branch-Id':branchId},body:JSON.stringify(payload)});resetItem();await loadAll();flashMessage(editingItem?'Item updated':'Item added')}catch(e){flashError(e)}finally{setBusy(false)}}
  async function removeItem(id:string){if(!confirm('Delete this menu item?'))return;setBusy(true);try{await apiFetch(`/api/v1/menu/items/${id}`,{method:'DELETE',headers:{'X-Branch-Id':branchId}});await loadAll();flashMessage('Item deleted')}catch(e){flashError(e)}finally{setBusy(false)}}
  async function toggleAvailability(item:Item){try{await apiFetch(`/api/v1/menu/items/${item.id}`,{method:'PATCH',headers:{'X-Branch-Id':branchId},body:JSON.stringify({is_available:!item.is_available})});await loadAll()}catch(e){flashError(e)}}

  if(!membership)return <main className="grid min-h-screen place-items-center p-6">Loading menu…</main>;
  return <main className="min-h-screen bg-slate-50 p-5 lg:p-8"><div className="mx-auto max-w-7xl">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><Link href="/dashboard" className="text-sm font-semibold text-slate-500">← Dashboard</Link><h1 className="mt-2 text-3xl font-bold">Menu Management</h1><p className="mt-1 text-sm text-slate-500">{membership.branches?.name} · {membership.role}</p></div><div className="rounded-2xl bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-slate-100">Categories <b>{categories.length}</b> · Items <b>{items.length}</b> · Modifiers <b>{modifiers.length}</b></div></div>
    {message&&<div className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}{error&&<div className="mt-5 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
    <div className="mt-6 flex gap-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-100">{(['items','categories','modifiers'] as const).map(t=><button key={t} onClick={()=>setTab(t)} className={`${button} ${tab===t?'bg-slate-900 text-white':'text-slate-600 hover:bg-slate-100'}`}>{t[0].toUpperCase()+t.slice(1)}</button>)}</div>

    {tab==='items'&&<section className="mt-6 grid gap-6 lg:grid-cols-[390px_1fr]">
      <form onSubmit={saveItem} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">{editingItem?'Edit Item':'Add Item'}</h2>{editingItem&&<button type="button" onClick={resetItem} className="text-xs font-semibold text-slate-500">Cancel</button>}</div>
        <label className="mt-5 block text-sm font-semibold">Item name<input className={input} value={itemForm.name} onChange={e=>setItemForm({...itemForm,name:e.target.value})} required /></label>
        <label className="mt-4 block text-sm font-semibold">Category<select className={input} value={itemForm.category_id} onChange={e=>setItemForm({...itemForm,category_id:e.target.value})}><option value="">Uncategorized</option>{activeCategories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-sm font-semibold">Price<input className={input} type="number" min="0" step="0.01" value={itemForm.price} onChange={e=>setItemForm({...itemForm,price:e.target.value})} required /></label><label className="text-sm font-semibold">Tax %<input className={input} type="number" min="0" max="100" step="0.01" value={itemForm.tax_rate} onChange={e=>setItemForm({...itemForm,tax_rate:e.target.value})}/></label></div>
        <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-sm font-semibold">Cost price<input className={input} type="number" min="0" step="0.01" value={itemForm.cost_price} onChange={e=>setItemForm({...itemForm,cost_price:e.target.value})}/></label><label className="text-sm font-semibold">SKU<input className={input} value={itemForm.sku} onChange={e=>setItemForm({...itemForm,sku:e.target.value})}/></label></div>
        <label className="mt-4 block text-sm font-semibold">Description<textarea className={input} rows={3} value={itemForm.description} onChange={e=>setItemForm({...itemForm,description:e.target.value})}/></label>
        <label className="mt-4 block text-sm font-semibold">Modifiers<select multiple className={input+' min-h-28'} value={itemForm.modifier_ids} onChange={e=>setItemForm({...itemForm,modifier_ids:Array.from(e.target.selectedOptions).map(o=>o.value)})}>{modifiers.filter(m=>m.is_active).map(m=><option key={m.id} value={m.id}>{m.name} (+₹{Number(m.price).toFixed(2)})</option>)}</select></label>
        <div className="mt-4 flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={itemForm.is_veg} onChange={e=>setItemForm({...itemForm,is_veg:e.target.checked})}/> Veg</label><label className="flex items-center gap-2"><input type="checkbox" checked={itemForm.is_available} onChange={e=>setItemForm({...itemForm,is_available:e.target.checked})}/> Available</label><label className="flex items-center gap-2"><input type="checkbox" checked={itemForm.is_active} onChange={e=>setItemForm({...itemForm,is_active:e.target.checked})}/> Active</label></div>
        <button disabled={busy} className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50">{busy?'Saving…':editingItem?'Update Item':'Add Item'}</button>
      </form>
      <div className="space-y-3">{items.map(item=><div key={item.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100"><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{item.name}</h3><span className={`rounded-full px-2 py-1 text-xs font-bold ${item.is_veg?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}`}>{item.is_veg?'VEG':'NON-VEG'}</span><span className={`rounded-full px-2 py-1 text-xs font-bold ${item.is_available?'bg-blue-50 text-blue-700':'bg-slate-100 text-slate-500'}`}>{item.is_available?'AVAILABLE':'UNAVAILABLE'}</span></div><p className="mt-1 text-sm text-slate-500">{item.categories?.name||'Uncategorized'} · {item.sku||'No SKU'}</p></div><div className="text-right"><div className="text-xl font-bold">₹{Number(item.price).toFixed(2)}</div><div className="text-xs text-slate-400">Tax {Number(item.tax_rate).toFixed(2)}%</div></div></div><p className="mt-3 text-sm text-slate-600">{item.description||'No description'}</p><div className="mt-4 flex flex-wrap gap-2">{item.menu_item_modifiers.map(x=>x.modifiers&&<span key={x.modifier_id} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold">+ {x.modifiers.name}</span>)}</div><div className="mt-4 flex flex-wrap gap-2"><button onClick={()=>toggleAvailability(item)} className={`${button} border`}>{item.is_available?'Mark unavailable':'Mark available'}</button><button onClick={()=>{setEditingItem(item);setItemForm({name:item.name,description:item.description||'',category_id:item.category_id||'',sku:item.sku||'',price:String(item.price),cost_price:item.cost_price===null?'':String(item.cost_price),tax_rate:String(item.tax_rate),is_veg:item.is_veg,is_available:item.is_available,is_active:item.is_active,modifier_ids:item.menu_item_modifiers.map(x=>x.modifier_id)})}} className={`${button} border`}>Edit</button><button onClick={()=>removeItem(item.id)} className={`${button} bg-red-50 text-red-700`}>Delete</button></div></div>)}{items.length===0&&<div className="rounded-2xl bg-white p-10 text-center text-sm text-slate-500">No menu items yet. Add your first item.</div>}</div>
    </section>}

    {tab==='categories'&&<section className="mt-6 grid gap-6 lg:grid-cols-[390px_1fr]"><form onSubmit={saveCategory} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">{editingCategory?'Edit Category':'Add Category'}</h2>{editingCategory&&<button type="button" onClick={resetCategory} className="text-xs font-semibold text-slate-500">Cancel</button>}</div><input className={input+' mt-5'} placeholder="e.g. Starters" value={categoryName} onChange={e=>setCategoryName(e.target.value)} required/><button disabled={busy} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-bold text-white">{editingCategory?'Update Category':'Add Category'}</button></form><div className="grid gap-3 sm:grid-cols-2">{categories.map(c=><div key={c.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100"><div className="flex justify-between gap-3"><h3 className="font-bold">{c.name}</h3><span className="text-xs text-slate-400">#{c.sort_order}</span></div><p className="mt-1 text-sm text-slate-500">{c.is_active?'Active':'Inactive'}</p><div className="mt-4 flex gap-2"><button className={`${button} border`} onClick={()=>{setEditingCategory(c);setCategoryName(c.name)}}>Edit</button><button className={`${button} bg-red-50 text-red-700`} onClick={()=>removeCategory(c.id)}>Delete</button></div></div>)}</div></section>}

    {tab==='modifiers'&&<section className="mt-6 grid gap-6 lg:grid-cols-[390px_1fr]"><form onSubmit={saveModifier} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">{editingModifier?'Edit Modifier':'Add Modifier'}</h2>{editingModifier&&<button type="button" onClick={resetModifier} className="text-xs font-semibold text-slate-500">Cancel</button>}</div><label className="mt-5 block text-sm font-semibold">Name<input className={input} placeholder="Extra Cheese" value={modifierName} onChange={e=>setModifierName(e.target.value)} required/></label><label className="mt-4 block text-sm font-semibold">Extra price<input className={input} type="number" min="0" step="0.01" value={modifierPrice} onChange={e=>setModifierPrice(e.target.value)}/></label><button disabled={busy} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-bold text-white">{editingModifier?'Update Modifier':'Add Modifier'}</button></form><div className="grid gap-3 sm:grid-cols-2">{modifiers.map(m=><div key={m.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100"><div className="flex items-center justify-between gap-3"><h3 className="font-bold">{m.name}</h3><span className="font-bold">+₹{Number(m.price).toFixed(2)}</span></div><p className="mt-1 text-sm text-slate-500">{m.is_active?'Active':'Inactive'}</p><div className="mt-4 flex gap-2"><button className={`${button} border`} onClick={()=>{setEditingModifier(m);setModifierName(m.name);setModifierPrice(String(m.price))}}>Edit</button><button className={`${button} bg-red-50 text-red-700`} onClick={()=>removeModifier(m.id)}>Delete</button></div></div>)}</div></section>}
  </div></main>;
}
