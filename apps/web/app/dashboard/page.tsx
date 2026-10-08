'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import { Logo } from '@/components/Logo';

type Me = {
  success: boolean;
  data: {
    user: { id: string; email?: string };
    profile: { full_name: string | null } | null;
    memberships: Array<{
      id: string;
      role: string;
      branches: { id: string; name: string; code: string | null; company_id: string } | null;
    }>;
  };
};

const nav = [
  ['Overview', '/dashboard', '⌂'],
  ['POS Billing', '/pos', '▣'],
  ['Tables', '/tables', '▦'],
  ['Orders', '/orders', '◫'],
  ['Kitchen / KOT', '/kitchen', '◈'],
  ['Menu', '/menu', '☷'],
  ['Inventory', '/inventory', '▤'],
  ['Purchases', '/purchases', '↗'],
  ['Suppliers', '/suppliers', '♧'],
];

const quickActions = [
  { title: 'New Bill', desc: 'Start a customer order', href: '/pos', icon: '＋' },
  { title: 'Open Tables', desc: 'Manage table status', href: '/tables', icon: '▦' },
  { title: 'Kitchen', desc: 'View live KOT queue', href: '/kitchen', icon: '◈' },
  { title: 'Inventory', desc: 'Check stock levels', href: '/inventory', icon: '▤' },
];

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me['data'] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }
      try {
        const payload = await apiFetch<Me>('/api/v1/me');
        if (active) setMe(payload.data);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Unable to load workspace');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f5f7fb]">
        <div className="text-center dp-fade-up">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-slate-950 text-xl font-black text-white shadow-xl dp-float">DP</div>
          <p className="font-semibold text-slate-700">Loading DinePulse…</p>
          <p className="mt-1 text-sm text-slate-400">Preparing your restaurant workspace</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f5f7fb] p-6">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200 dp-scale-in">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-2xl text-red-600">!</div>
          <h1 className="mt-5 text-2xl font-black text-slate-950">Workspace could not load</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{error}</p>
          <div className="mt-6 flex justify-center gap-3">
            <button onClick={() => location.reload()} className="dp-interactive rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white">Retry</button>
            <button onClick={signOut} className="dp-interactive rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700">Sign out</button>
          </div>
        </div>
      </main>
    );
  }

  if (!me?.memberships?.length) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f5f7fb] p-6">
        <div className="w-full max-w-lg rounded-3xl bg-white p-9 text-center shadow-xl ring-1 ring-slate-200 dp-scale-in">
          <Logo />
          <h1 className="mt-10 text-3xl font-black text-slate-950">Set up your restaurant</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">Your account is ready, but no restaurant branch is connected yet. Complete onboarding to open DinePulse.</p>
          <button onClick={() => router.push('/onboarding')} className="dp-interactive mt-7 rounded-xl bg-slate-950 px-6 py-3 text-sm font-bold text-white">Complete setup →</button>
        </div>
      </main>
    );
  }

  const branch = me.memberships[0];

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] border-r border-slate-200 bg-white lg:block dp-fade-in">
        <div className="px-6 py-6"><Logo /></div>
        <div className="px-4">
          <p className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Restaurant</p>
          <div className="mb-5 rounded-2xl bg-slate-50 px-3 py-3 dp-scale-in">
            <p className="truncate text-sm font-bold">{branch.branches?.name || 'My Restaurant'}</p>
            <p className="mt-0.5 text-xs text-slate-400">{branch.role}</p>
          </div>
          <nav className="space-y-1">
            {nav.map(([name, href, icon], i) => (
              <Link key={name} href={href} className={`dp-sidebar-link flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold ${i === 0 ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}>
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 text-base">{icon}</span>
                {name}
              </Link>
            ))}
          </nav>
        </div>
        <div className="absolute bottom-5 left-4 right-4">
          <button onClick={signOut} className="dp-interactive flex w-full items-center justify-center rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">Sign out</button>
        </div>
      </aside>

      <main className="lg:pl-[248px]">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur lg:px-8 dp-fade-in">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Restaurant operations</p>
            <h1 className="mt-0.5 text-xl font-black">Good day, {me.profile?.full_name?.split(' ')[0] || 'there'} 👋</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/pos" className="dp-interactive rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm">＋ New Bill</Link>
            <div className="hidden h-10 w-10 place-items-center rounded-full bg-slate-100 text-sm font-black sm:grid dp-scale-in">{(me.profile?.full_name || me.user.email || 'U').slice(0, 1).toUpperCase()}</div>
          </div>
        </header>

        <section className="p-5 lg:p-8">
          <div className="relative overflow-hidden rounded-[28px] bg-slate-950 p-6 text-white shadow-xl dp-scale-in lg:p-8">
            <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl dp-float" />
            <div className="relative flex flex-col justify-between gap-8 md:flex-row md:items-end">
              <div>
                <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-slate-300">DinePulse POS</span>
                <h2 className="mt-4 max-w-2xl text-3xl font-black tracking-tight lg:text-4xl">Everything your restaurant needs, in one workspace.</h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">Billing, tables, KOT, menu, inventory and purchasing are connected to your branch.</p>
              </div>
              <Link href="/pos" className="dp-interactive shrink-0 rounded-2xl bg-white px-5 py-3 text-center text-sm font-black text-slate-950">Open POS →</Link>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Today’s Sales', '₹0', 'Ready for live billing'],
              ['Orders', '0', 'No orders yet'],
              ['Open Tables', '0', 'Table management ready'],
              ['Low Stock', '0', 'Inventory monitoring ready'],
            ].map(([label, value, sub], index) => (
              <div key={label} className={`dp-card rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dp-fade-up dp-delay-${index + 1}`}>
                <p className="text-sm font-semibold text-slate-500">{label}</p>
                <p className="mt-3 text-2xl font-black">{value}</p>
                <p className="mt-1 text-xs text-slate-400">{sub}</p>
              </div>
            ))}
          </div>

          <div className="mt-8">
            <div className="flex items-end justify-between">
              <div><h3 className="text-lg font-black">Quick actions</h3><p className="mt-1 text-sm text-slate-500">Jump straight into daily operations.</p></div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {quickActions.map((item, index) => (
                <Link key={item.title} href={item.href} className={`dp-card group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dp-fade-up dp-delay-${index + 2}`}>
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-xl font-black transition-colors duration-200 group-hover:bg-slate-950 group-hover:text-white">{item.icon}</span>
                  <h4 className="mt-4 font-black">{item.title}</h4>
                  <p className="mt-1 text-sm text-slate-500">{item.desc}</p>
                  <p className="mt-4 text-xs font-black text-slate-400 transition-colors group-hover:text-slate-950">OPEN →</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}