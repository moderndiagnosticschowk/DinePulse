'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Category = { id: string; name: string };
type Item = { id: string; category_id: string | null; name: string; price: number; tax_rate?: number; is_veg: boolean; is_available: boolean };
type Line = { item: Item; quantity: number };
type QueuedOrder = {
  clientOrderId: string;
  branchId: string;
  orderType: 'QUICK_BILL';
  items: Array<{ menu_item_id: string; quantity: number }>;
  createdAt: string;
};

const CACHE_PREFIX = 'dinepulse:pos:v1:';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function POSPage() {
  const [branchId, setBranchId] = useState('');
  const [userId, setUserId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [category, setCategory] = useState('all');
  const [cart, setCart] = useState<Line[]>([]);
  const [queuedOrders, setQueuedOrders] = useState<QueuedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const syncLock = useRef(false);

  const queueKey = branchId ? `${CACHE_PREFIX}${branchId}:queue` : '';
  const menuCacheKey = branchId ? `${CACHE_PREFIX}${branchId}:menu` : '';

  const persistQueue = useCallback((next: QueuedOrder[]) => {
    if (!branchId) return;
    localStorage.setItem(`${CACHE_PREFIX}${branchId}:queue`, JSON.stringify(next));
    setQueuedOrders(next);
  }, [branchId]);

  const syncQueue = useCallback(async () => {
    if (!branchId || !navigator.onLine || syncLock.current) return;
    const key = `${CACHE_PREFIX}${branchId}:queue`;
    const pending = readJson<QueuedOrder[]>(key, []);
    if (!pending.length) {
      setQueuedOrders([]);
      return;
    }

    syncLock.current = true;
    setSyncing(true);
    let synced = 0;
    try {
      let remaining = [...pending];
      for (const draft of pending) {
        const { error } = await supabase.rpc('create_pos_order', {
          p_branch_id: branchId,
          p_client_order_id: draft.clientOrderId,
          p_order_type: draft.orderType,
          p_table_id: null,
          p_items: draft.items,
          p_notes: 'Created from POS offline queue',
        });
        if (error) {
          setMessage(`Sync paused: ${error.message}. Pending orders are saved on this device.`);
          break;
        }
        remaining = remaining.filter(order => order.clientOrderId !== draft.clientOrderId);
        localStorage.setItem(key, JSON.stringify(remaining));
        setQueuedOrders(remaining);
        synced += 1;
      }
      if (synced > 0) setMessage(`${synced} queued order${synced === 1 ? '' : 's'} synced successfully.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sync failed. Orders remain saved on this device.');
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }, [branchId]);

  useEffect(() => {
    let active = true;
    setOnline(navigator.onLine);

    const onOnline = () => {
      setOnline(true);
      void syncQueue();
    };
    const onOffline = () => {
      setOnline(false);
      setMessage('You are offline. New bills will be queued on this device.');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          if (active) {
            setMessage('Please sign in to open the POS.');
            setLoading(false);
          }
          return;
        }
        const uid = session.user.id;
        if (active) setUserId(uid);

        let selectedBranch = localStorage.getItem(`${CACHE_PREFIX}user:${uid}:branch`) ?? '';
        if (navigator.onLine) {
          const { data: membership } = await supabase
            .from('branch_memberships')
            .select('branch_id')
            .eq('user_id', uid)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();
          if (membership?.branch_id) {
            selectedBranch = membership.branch_id;
            localStorage.setItem(`${CACHE_PREFIX}user:${uid}:branch`, selectedBranch);
          }
        }
        if (!selectedBranch) {
          if (active) {
            setMessage('No branch is available. Connect to the internet and complete restaurant onboarding first.');
            setLoading(false);
          }
          return;
        }
        if (active) setBranchId(selectedBranch);

        const savedMenu = readJson<{ categories: Category[]; items: Item[] }>(
          `${CACHE_PREFIX}${selectedBranch}:menu`,
          { categories: [], items: [] },
        );
        if (active) {
          setCategories(savedMenu.categories);
          setItems(savedMenu.items);
          setQueuedOrders(readJson<QueuedOrder[]>(`${CACHE_PREFIX}${selectedBranch}:queue`, []));
        }

        if (navigator.onLine) {
          const [categoryResult, itemResult] = await Promise.all([
            supabase.from('categories').select('id,name').eq('branch_id', selectedBranch).eq('is_active', true).order('sort_order'),
            supabase.from('menu_items').select('id,category_id,name,price,tax_rate,is_veg,is_available').eq('branch_id', selectedBranch).eq('is_active', true).eq('is_available', true).order('name'),
          ]);
          if (!categoryResult.error && !itemResult.error && categoryResult.data && itemResult.data) {
            const fresh = { categories: categoryResult.data as Category[], items: itemResult.data as Item[] };
            localStorage.setItem(`${CACHE_PREFIX}${selectedBranch}:menu`, JSON.stringify(fresh));
            if (active) {
              setCategories(fresh.categories);
              setItems(fresh.items);
            }
          } else if (active && !savedMenu.items.length) {
            setMessage('Menu could not be loaded. Check your connection and Supabase access.');
          }
        }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Unable to initialize POS.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [syncQueue]);

  useEffect(() => {
    if (branchId && online && queuedOrders.length > 0) void syncQueue();
  }, [branchId, online, queuedOrders.length, syncQueue]);

  const visible = useMemo(
    () => category === 'all' ? items : items.filter(item => item.category_id === category),
    [items, category],
  );
  const total = cart.reduce((sum, line) => sum + Number(line.item.price) * line.quantity, 0);

  function add(item: Item) {
    setCart(current => {
      const existing = current.find(line => line.item.id === item.id);
      return existing
        ? current.map(line => line.item.id === item.id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { item, quantity: 1 }];
    });
  }

  function changeQuantity(itemId: string, delta: number) {
    setCart(current => current
      .map(line => line.item.id === itemId ? { ...line, quantity: line.quantity + delta } : line)
      .filter(line => line.quantity > 0));
  }

  async function placeOrder() {
    if (!branchId || !cart.length) return;
    if (!userId) {
      setMessage('Please sign in before creating an order.');
      return;
    }

    const clientOrderId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `pos-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    const draft: QueuedOrder = {
      clientOrderId,
      branchId,
      orderType: 'QUICK_BILL',
      items: cart.map(line => ({ menu_item_id: line.item.id, quantity: line.quantity })),
      createdAt: new Date().toISOString(),
    };
    const next = [...readJson<QueuedOrder[]>(queueKey, []), draft];
    persistQueue(next);
    setCart([]);
    setMessage(online
      ? 'Order saved. Syncing securely with the server…'
      : 'Order queued offline. It will sync when the connection returns.');
    if (online) await syncQueue();
  }

  if (loading) return <main className="grid min-h-screen place-items-center">Loading POS…</main>;

  return (
    <main className="min-h-screen bg-slate-50 p-4 lg:p-6">
      <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[1fr_360px]">
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black text-slate-950">DinePulse POS</h1>
              <p className="mt-1 text-sm text-slate-500">Offline-ready billing with automatic order sync.</p>
            </div>
            <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              {online ? '● Online' : '● Offline'}
            </span>
          </div>

          {!online && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Offline mode: menu uses the last saved cache. Orders are stored on this device until sync succeeds.</div>}

          <div className="mb-4 flex flex-wrap gap-2">
            <button onClick={() => setCategory('all')} className={`rounded-full px-4 py-2 text-sm font-semibold ${category === 'all' ? 'bg-slate-900 text-white' : 'bg-white'}`}>All</button>
            {categories.map(item => <button key={item.id} onClick={() => setCategory(item.id)} className={`rounded-full px-4 py-2 text-sm font-semibold ${category === item.id ? 'bg-slate-900 text-white' : 'bg-white'}`}>{item.name}</button>)}
          </div>

          {visible.length === 0 ? (
            <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500">{online ? 'No available menu items for this branch.' : 'No cached menu found. Connect once to load menu items before using offline mode.'}</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map(item => (
                <button key={item.id} onClick={() => add(item)} className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-100 hover:ring-slate-300">
                  <div className="flex justify-between gap-3"><span className="font-bold">{item.name}</span><span className="font-semibold">₹{Number(item.price).toFixed(2)}</span></div>
                  <span className="mt-2 inline-block text-xs text-slate-500">{item.is_veg ? 'VEG' : 'NON-VEG'}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="h-fit rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Current Bill</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold">{cart.length} lines</span>
          </div>
          <div className="mt-4 space-y-3">
            {cart.length === 0 ? <p className="text-sm text-slate-400">Tap menu items to add.</p> : cart.map(line => (
              <div key={line.item.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0"><p className="truncate font-medium">{line.item.name}</p><p className="text-xs text-slate-500">₹{Number(line.item.price).toFixed(2)} each</p></div>
                <div className="flex items-center gap-2">
                  <button aria-label={`Decrease ${line.item.name}`} onClick={() => changeQuantity(line.item.id, -1)} className="grid h-7 w-7 place-items-center rounded-lg border">−</button>
                  <span className="w-4 text-center">{line.quantity}</span>
                  <button aria-label={`Increase ${line.item.name}`} onClick={() => changeQuantity(line.item.id, 1)} className="grid h-7 w-7 place-items-center rounded-lg border">+</button>
                  <span className="w-20 text-right font-semibold">₹{(Number(line.item.price) * line.quantity).toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-between border-t pt-4 text-lg font-bold"><span>Estimated total</span><span>₹{total.toFixed(2)}</span></div>
          <p className="mt-1 text-xs text-slate-400">Final price and tax are validated by Supabase when synced.</p>
          <button disabled={!cart.length || !branchId} onClick={placeOrder} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-40">Create KOT / Order</button>

          <div className="mt-5 rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3"><span className="text-sm font-bold">Pending sync</span><span className="rounded-full bg-white px-2.5 py-1 text-sm font-black">{queuedOrders.length}</span></div>
            <p className="mt-1 text-xs text-slate-500">{syncing ? 'Syncing orders…' : queuedOrders.length ? 'Orders are safely queued on this device.' : 'All local orders are synced.'}</p>
            {queuedOrders.length > 0 && <button disabled={!online || syncing} onClick={() => void syncQueue()} className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold disabled:opacity-40">{syncing ? 'Syncing…' : 'Retry sync'}</button>}
          </div>
          {message && <p role="status" className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{message}</p>}
        </aside>
      </div>
    </main>
  );
}
