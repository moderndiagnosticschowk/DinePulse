'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type OrderRow = {
  id: string;
  order_number: number | null;
  status: string;
  order_type: string;
  grand_total: number | string;
  created_at: string;
  paid_at: string | null;
};
type ItemRow = { order_id: string; item_name: string; quantity: number | string; line_total: number | string };
type PaymentRow = { order_id: string; payment_method: string; amount: number | string; status: string };
type DaySales = { label: string; sales: number; orders: number };
type Membership = { branch_id: string; role: string; branches: { id: string; name: string; code: string | null }[] | null };

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

export default function ReportsPage() {
  const [range, setRange] = useState<7 | 30 | 90>(7);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [salesOrders, setSalesOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [branchId, setBranchId] = useState('');
  const loadRequestRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!branchId) return;
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError('');
    setOrders([]);
    setSalesOrders([]);
    setItems([]);
    setPayments([]);
    try {
      const to = new Date();
      const from = new Date(to);
      from.setHours(0, 0, 0, 0);
      from.setDate(from.getDate() - (range - 1));
      const fromIso = from.toISOString();
      const toIso = to.toISOString();
      const pageSize = 500;
      const rows: OrderRow[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error: ordersError } = await supabase
          .from('orders')
          .select('id,order_number,status,order_type,grand_total,created_at,paid_at')
          .eq('branch_id', branchId)
          .gte('created_at', fromIso)
          .lte('created_at', toIso)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (ordersError) throw ordersError;
        const page = (data ?? []) as OrderRow[];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      if (requestId !== loadRequestRef.current) return;

      // Sales are attributed to payment time, not order creation time. An order
      // created yesterday but paid today belongs in today's sales report.
      const paidRows: OrderRow[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error: paidOrdersError } = await supabase
          .from('orders')
          .select('id,order_number,status,order_type,grand_total,created_at,paid_at')
          .eq('branch_id', branchId)
          .eq('status', 'PAID')
          .gte('paid_at', fromIso)
          .lte('paid_at', toIso)
          .order('paid_at', { ascending: false })
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (paidOrdersError) throw paidOrdersError;
        const page = (data ?? []) as OrderRow[];
        paidRows.push(...page);
        if (page.length < pageSize) break;
      }
      if (requestId !== loadRequestRef.current) return;

      const paidIds = paidRows.map(order => order.id);
      if (!paidIds.length) {
        setOrders(rows);
        setSalesOrders([]);
        setItems([]);
        setPayments([]);
        return;
      }
      const itemRows: ItemRow[] = [];
      const paymentRows: PaymentRow[] = [];
      const idBatchSize = 100;
      for (let index = 0; index < paidIds.length; index += idBatchSize) {
        const idBatch = paidIds.slice(index, index + idBatchSize);
        for (let offset = 0; ; offset += pageSize) {
          const [itemResult, paymentResult] = await Promise.all([
            supabase.from('order_items').select('id,order_id,item_name,quantity,line_total').in('order_id', idBatch).order('id', { ascending: true }).range(offset, offset + pageSize - 1),
            supabase.from('payments').select('id,order_id,payment_method,amount,status').in('order_id', idBatch).eq('status', 'COMPLETED').order('id', { ascending: true }).range(offset, offset + pageSize - 1),
          ]);
          if (itemResult.error) throw itemResult.error;
          if (paymentResult.error) throw paymentResult.error;
          const itemPage = (itemResult.data ?? []) as ItemRow[];
          const paymentPage = (paymentResult.data ?? []) as PaymentRow[];
          itemRows.push(...itemPage);
          paymentRows.push(...paymentPage);
          if (itemPage.length < pageSize && paymentPage.length < pageSize) break;
        }
      }
      if (requestId !== loadRequestRef.current) return;
      setOrders(rows);
      setSalesOrders(paidRows);
      setItems(itemRows);
      setPayments(paymentRows);
    } catch (e) {
      if (requestId === loadRequestRef.current) {
        setError(e instanceof Error ? e.message : 'Unable to load reports.');
      }
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [range, branchId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          if (active) {
            setError('Please sign in to view reports.');
            setLoading(false);
          }
          return;
        }
        const { data, error: membershipError } = await supabase
          .from('branch_memberships')
          .select('branch_id,role,branches(id,name,code)')
          .eq('user_id', session.user.id)
          .eq('is_active', true);
        if (membershipError) throw membershipError;
        const available = (data ?? []) as Membership[];
        if (!active) return;
        setMemberships(available);
        const savedBranchId = localStorage.getItem('dinepulse:active-branch-id');
        const chosenBranchId = available.find(membership => membership.branch_id === savedBranchId)?.branch_id
          ?? available[0]?.branch_id
          ?? '';
        if (!chosenBranchId) {
          setError('No active restaurant branch is linked to this account.');
          setLoading(false);
          return;
        }
        setBranchId(chosenBranchId);
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Unable to load branch memberships.');
          setLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!branchId) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) void load();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
      loadRequestRef.current += 1;
    };
  }, [load, branchId]);


  const paidOrders = useMemo(() => salesOrders, [salesOrders]);
  const sales = paidOrders.reduce((sum, order) => sum + Number(order.grand_total), 0);
  const averageBill = paidOrders.length ? sales / paidOrders.length : 0;
  const openOrders = orders.filter(order => ['OPEN', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'SERVED'].includes(order.status)).length;

  const daily = useMemo<DaySales[]>(() => {
    const result: DaySales[] = [];
    const today = new Date();
    for (let offset = range - 1; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - offset);
      const key = day.toLocaleDateString('en-CA');
      const matching = paidOrders.filter(order => order.paid_at !== null && new Date(order.paid_at).toLocaleDateString('en-CA') === key);
      result.push({
        label: day.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        sales: matching.reduce((sum, order) => sum + Number(order.grand_total), 0),
        orders: matching.length,
      });
    }
    return result;
  }, [paidOrders, range]);

  const topItems = useMemo(() => {
    const grouped = new Map<string, { quantity: number; sales: number }>();
    for (const item of items) {
      const existing = grouped.get(item.item_name) ?? { quantity: 0, sales: 0 };
      existing.quantity += Number(item.quantity);
      existing.sales += Number(item.line_total);
      grouped.set(item.item_name, existing);
    }
    return [...grouped.entries()].map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.quantity - a.quantity).slice(0, 8);
  }, [items]);

  const paymentMix = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const payment of payments) grouped.set(payment.payment_method, (grouped.get(payment.payment_method) ?? 0) + Number(payment.amount));
    return [...grouped.entries()].sort((a, b) => b[1] - a[1]);
  }, [payments]);

  const maxSales = Math.max(1, ...daily.map(day => day.sales));
  const maxItemQty = Math.max(1, ...topItems.map(item => item.quantity));

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-950 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/dashboard" className="text-sm font-bold text-slate-500 hover:text-slate-950">← Dashboard</Link>
            <h1 className="mt-3 text-3xl font-black tracking-tight">Reports & Analytics</h1>
            <p className="mt-1 text-sm text-slate-500">Reports for {memberships.find(membership => membership.branch_id === branchId)?.branches?.[0]?.name ?? 'your selected branch'}: sales, trends, best sellers and payment mix.</p>
          </div>
          {memberships.length > 1 && (
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">
              Branch
              <select
                aria-label="Select report branch"
                value={branchId}
                onChange={event => {
                  const nextBranchId = event.target.value;
                  if (memberships.some(membership => membership.branch_id === nextBranchId)) {
                    localStorage.setItem('dinepulse:active-branch-id', nextBranchId);
                    setBranchId(nextBranchId);
                  }
                }}
                className="max-w-48 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm font-bold text-slate-800"
              >
                {memberships.map(membership => (
                  <option key={membership.branch_id} value={membership.branch_id}>
                    {membership.branches?.[0]?.name ?? membership.branch_id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex gap-2 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
            {([7, 30, 90] as const).map(days => (
              <button key={days} onClick={() => setRange(days)} className={`rounded-lg px-3 py-2 text-sm font-bold ${range === days ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{days} days</button>
            ))}
            <button onClick={() => void load()} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">Refresh</button>
          </div>
        </div>

        {error && <div role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

        {loading ? <div className="mt-8 rounded-2xl bg-white p-8 text-sm text-slate-500">Loading reports…</div> : (
          <>
            <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Paid sales', value: money(sales), sub: `Last ${range} days` },
                { label: 'Paid orders', value: String(paidOrders.length), sub: 'Completed payments' },
                { label: 'Average bill', value: money(averageBill), sub: 'Paid sales ÷ paid orders' },
                { label: 'Open orders', value: String(openOrders), sub: 'Awaiting completion' },
              ].map((card) => (
                <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm font-semibold text-slate-500">{card.label}</p>
                  <p className="mt-3 text-2xl font-black">{card.value}</p>
                  <p className="mt-1 text-xs text-slate-400">{card.sub}</p>
                </div>
              ))}
            </section>

            <section className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-black">Daily sales</h2><p className="mt-1 text-sm text-slate-500">Only orders marked PAID are counted.</p></div><span className="text-xs font-bold text-slate-400">INR</span></div>
                <div className="mt-6 flex h-56 items-end gap-1.5 sm:gap-2">
                  {daily.map((day, index) => (
                    <div key={day.label + index} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                      <span className="hidden text-[10px] font-semibold text-slate-500 sm:block">{day.sales ? money(day.sales) : '—'}</span>
                      <div title={`${day.label}: ${money(day.sales)} · ${day.orders} paid orders`} className="w-full max-w-10 rounded-t-md bg-slate-900 transition-all" style={{ height: `${Math.max(day.sales ? 4 : 1, day.sales / maxSales * 100)}%` }} />
                      <span className="truncate text-[10px] text-slate-500">{day.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-black">Payment mix</h2>
                <p className="mt-1 text-sm text-slate-500">Completed payment records in this period.</p>
                {paymentMix.length ? <div className="mt-5 space-y-4">{paymentMix.map(([method, amount]) => {
                  const totalPayments = paymentMix.reduce((sum, entry) => sum + entry[1], 0);
                  return <div key={method}><div className="mb-1.5 flex justify-between gap-3 text-sm"><span className="font-semibold">{method.replaceAll('_', ' ')}</span><span className="font-bold">{money(amount)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-900" style={{ width: `${totalPayments ? amount / totalPayments * 100 : 0}%` }} /></div></div>;
                })}</div> : <p className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No completed payments in this period.</p>}
              </div>
            </section>

            <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div><h2 className="text-lg font-black">Best-selling items</h2><p className="mt-1 text-sm text-slate-500">Ranked by quantity across orders paid in the selected period.</p></div>
              {topItems.length ? <div className="mt-5 space-y-4">{topItems.map((item, index) => <div key={item.name}><div className="mb-1.5 flex flex-wrap justify-between gap-2 text-sm"><span className="font-semibold">{index + 1}. {item.name}</span><span className="text-slate-500">{item.quantity} sold · {money(item.sales)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-900" style={{ width: `${item.quantity / maxItemQty * 100}%` }} /></div></div>)}</div> : <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No order items found in this period.</p>}
            </section>

            <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 p-5"><div><h2 className="text-lg font-black">Recent orders</h2><p className="mt-1 text-sm text-slate-500">Latest orders in the selected period.</p></div><Link href="/orders" className="text-sm font-bold text-slate-600 hover:text-slate-950">All orders →</Link></div>
              <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Order</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Total</th></tr></thead><tbody>{orders.slice(0, 12).map(order => <tr key={order.id} className="border-t border-slate-100"><td className="px-5 py-3 font-bold">#{order.order_number ?? order.id.slice(0, 8)}</td><td className="whitespace-nowrap px-5 py-3 text-slate-500">{new Date(order.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td className="px-5 py-3">{order.order_type.replaceAll('_', ' ')}</td><td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${order.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : order.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'}`}>{order.status}</span></td><td className="px-5 py-3 text-right font-bold">{money(Number(order.grand_total))}</td></tr>)}</tbody></table></div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
