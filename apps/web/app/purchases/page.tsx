'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type InventoryItem = { id: string; name: string; unit: string; current_stock: number };
type Supplier = { id: string; name: string };
type Purchase = {
  id: string;
  invoice_number: string | null;
  purchase_date: string;
  total_amount: number;
  status: string;
  suppliers: { name: string } | null;
};

export default function PurchasesPage() {
  const [branchId, setBranchId] = useState('');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rows, setRows] = useState<Purchase[]>([]);
  const [invoice, setInvoice] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const load = useCallback(async (branch: string) => {
    if (!branch) return;
    const headers = { 'X-Branch-Id': branch };
    const [inventory, purchases, supplierList] = await Promise.all([
      apiFetch<{ data: InventoryItem[] }>('/api/v1/inventory/items', { headers }),
      apiFetch<{ data: Purchase[] }>('/api/v1/inventory/purchases', { headers }),
      apiFetch<{ data: Supplier[] }>('/api/v1/inventory/suppliers', { headers }),
    ]);
    setItems(inventory.data);
    setRows(purchases.data);
    setSuppliers(supplierList.data);
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch<{ data: { memberships: Array<{ branches: { id: string } | null }> } }>('/api/v1/me')
      .then(async result => {
        const branch = result.data.memberships[0]?.branches?.id;
        if (!branch || !active) return;
        setBranchId(branch);
        await load(branch);
      })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load purchases'); });
    return () => { active = false; };
  }, [load]);

  async function createPurchase() {
    if (!branchId || !itemId || !quantity || !unitCost || Number(quantity) <= 0 || Number(unitCost) < 0) {
      setError('Inventory item, a positive quantity and a valid unit cost are required.');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    const key = idempotencyKey || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `purchase-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setIdempotencyKey(key);
    try {
      await apiFetch('/api/v1/inventory/purchases', {
        method: 'POST',
        headers: { 'X-Branch-Id': branchId },
        body: JSON.stringify({
          supplier_id: supplierId || null,
          invoice_number: invoice.trim() || null,
          purchase_date: new Date().toISOString().slice(0, 10),
          items: [{ inventory_item_id: itemId, quantity: Number(quantity), unit_cost: Number(unitCost), tax_amount: 0 }],
          idempotency_key: key,
        }),
      });
      setInvoice(''); setSupplierId(''); setItemId(''); setQuantity(''); setUnitCost(''); setIdempotencyKey('');
      setMessage('Purchase saved as a draft. Use Receive & Add Stock when goods arrive.');
      await load(branchId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create purchase. Retry safely.');
    } finally { setBusy(false); }
  }

  async function receivePurchase(id: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      await apiFetch(`/api/v1/inventory/purchases/${id}/receive`, { method: 'POST', headers: { 'X-Branch-Id': branchId } });
      setMessage('Purchase received. Stock ledger updated; repeating this action will not add stock twice.');
      await load(branchId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to receive purchase');
    } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <div><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Stock management</p><h1 className="mt-1 text-3xl font-black">Purchases</h1><p className="mt-2 text-sm text-slate-500">Create a draft first; stock changes only after receiving goods.</p></div>
        {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}
        {message && <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{message}</div>}
        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <h2 className="font-bold">Create purchase draft</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input className="rounded-xl border p-3" placeholder="Supplier invoice #" value={invoice} onChange={e => setInvoice(e.target.value)} />
            <select className="rounded-xl border p-3" value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">No supplier selected</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <select className="rounded-xl border p-3" value={itemId} onChange={e => setItemId(e.target.value)}><option value="">Select inventory item *</option>{items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit}) · stock {i.current_stock}</option>)}</select>
            <input className="rounded-xl border p-3" type="number" min="0.001" step="0.001" placeholder="Quantity *" value={quantity} onChange={e => setQuantity(e.target.value)} />
            <input className="rounded-xl border p-3" type="number" min="0" step="0.01" placeholder="Unit cost (₹) *" value={unitCost} onChange={e => setUnitCost(e.target.value)} />
            <div className="flex items-center rounded-xl bg-slate-50 px-3 text-sm text-slate-500">Line total: ₹{(Number(quantity || 0) * Number(unitCost || 0)).toFixed(2)}</div>
          </div>
          <button disabled={busy || !branchId} onClick={createPurchase} className="mt-4 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Please wait…' : 'Save Purchase Draft'}</button>
        </section>
        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between"><div><h2 className="text-xl font-black">Purchase history</h2><p className="mt-1 text-sm text-slate-500">{rows.length} purchase(s)</p></div><button disabled={busy || !branchId} onClick={() => load(branchId).catch(e => setError(e instanceof Error ? e.message : 'Refresh failed'))} className="rounded-xl border bg-white px-4 py-2 text-sm font-bold disabled:opacity-50">Refresh</button></div>
          {rows.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No purchases yet. Create your first draft above.</div> : <div className="space-y-3">{rows.map(p => <article key={p.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100"><div className="flex flex-wrap items-start justify-between gap-3"><div><b>{p.invoice_number || 'No invoice number'}</b><p className="mt-1 text-sm text-slate-500">{p.suppliers?.name || 'No supplier'} · {p.purchase_date}</p><p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">{p.status || 'DRAFT'}</p></div><div className="text-right"><b>₹{Number(p.total_amount).toFixed(2)}</b>{p.status !== 'RECEIVED' && <button disabled={busy} onClick={() => receivePurchase(p.id)} className="mt-3 block rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Receive & Add Stock</button>}{p.status === 'RECEIVED' && <p className="mt-2 text-sm font-bold text-emerald-700">Stock received ✓</p>}</div></div></article>)}</div>}
        </section>
      </div>
    </main>
  );
}
