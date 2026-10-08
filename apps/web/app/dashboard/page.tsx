'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import { Logo } from '@/components/Logo';
import Link from 'next/link';

type Me = { success: boolean; data: { user: { id: string; email?: string }; profile: { full_name: string|null }|null; memberships: Array<{ id:string; role:string; branches:{id:string;name:string;code:string|null;company_id:string} | null }> } };

const nav=[['Dashboard','/dashboard'],['POS Billing','/pos'],['Tables','/tables'],['Orders','/orders'],['Kitchen','/kitchen'],['Menu','/menu'],['Inventory','/inventory'],['Purchases','/purchases'],['Suppliers','/suppliers'],['Customers','#'],['Staff','#'],['Expenses','#'],['Reports','#'],['Settings','#']];

export default function DashboardPage(){
  const router=useRouter(); const [loading,setLoading]=useState(true); const [me,setMe]=useState<Me['data']|null>(null); const [error,setError]=useState('');
  useEffect(()=>{let active=true;(async()=>{const {data:{session}}=await supabase.auth.getSession();if(!session){router.replace('/login');return;}try{const payload=await apiFetch<Me>('/api/v1/me');if(active)setMe(payload.data);}catch(e){if(active)setError(e instanceof Error?e.message:'Unable to load account');}finally{if(active)setLoading(false);}})();return()=>{active=false;}},[router]);
  async function signOut(){await supabase.auth.signOut();router.replace('/login');router.refresh();}
  if(loading)return <main className="grid min-h-screen place-items-center">Loading workspace…</main>;
  if(error)return <main className="grid min-h-screen place-items-center p-6"><div className="rounded-2xl bg-red-50 p-5 text-red-700">{error}</div></main>;
  if(!me?.memberships?.length)return <main className="grid min-h-screen place-items-center p-6"><div className="rounded-3xl bg-white p-8 text-center shadow"><h1 className="text-2xl font-bold">Workspace setup required</h1><p className="mt-2 text-sm text-slate-500">Complete onboarding to access the dashboard.</p><button onClick={()=>router.push('/onboarding')} className="mt-5 rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white">Complete setup</button></div></main>;
  const branch=me.memberships[0];
  return <div className="min-h-screen bg-slate-50"><aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-white p-5 lg:block"><Logo/><nav className="mt-8 space-y-1">{nav.map(([n,href],i)=>href==='#'?<div key={n} className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400">{n}</div>:<Link href={href} key={n} className={`block rounded-xl px-3 py-2.5 text-sm font-semibold ${i===0?'bg-slate-900 text-white':'text-slate-600 hover:bg-slate-100'}`}>{n}</Link>})}</nav></aside><main className="lg:pl-64"><header className="flex items-center justify-between border-b bg-white px-5 py-4 lg:px-8"><div><h1 className="text-xl font-bold">Dashboard</h1><p className="text-sm text-slate-500">{branch.branches?.name} · {branch.role}</p></div><button onClick={signOut} className="rounded-xl border px-3.5 py-2 text-sm font-semibold">Sign out</button></header><section className="p-5 lg:p-8"><div className="rounded-3xl bg-gradient-to-br from-slate-950 to-slate-800 p-6 text-white"><p className="text-sm text-slate-300">Welcome back</p><h2 className="mt-1 text-3xl font-bold">{me.profile?.full_name || me.user.email}</h2><p className="mt-2 max-w-2xl text-sm text-slate-300">Phase 1 + Phase 2 foundation is active. POS, tables, kitchen, inventory and reports will plug into this protected workspace in the next phases.</p></div><div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Today’s sales','₹0','Phase 3+'],['Orders','0','Phase 3+'],['Open tables','0','Phase 3+'],['Low stock','0','Phase 5']].map(([a,b,c])=><div key={a} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100"><p className="text-sm text-slate-500">{a}</p><div className="mt-2 text-2xl font-bold">{b}</div><p className="mt-1 text-xs text-slate-400">{c}</p></div>)}</div></section></main></div>;
}
