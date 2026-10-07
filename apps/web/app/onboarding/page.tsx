'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AuthCard } from '@/components/AuthCard';
import { Button } from '@/components/Button';

export default function OnboardingPage() {
  const router = useRouter();
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [name,setName]=useState(''); const [restaurant,setRestaurant]=useState(''); const [branch,setBranch]=useState('Main Branch'); const [error,setError]=useState(''); const [message,setMessage]=useState(''); const [loading,setLoading]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setError('');setMessage('');setLoading(true);
    const { data, error: signupError } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
    if(signupError){setLoading(false);return setError(signupError.message);}
    if(!data.user){setLoading(false);return setError('Account could not be created.');}
    if(!data.session){setLoading(false);return setMessage('Account created. Check your email to confirm, then sign in and complete workspace setup.');}
    const { error: rpcError } = await supabase.rpc('complete_workspace_onboarding', { p_company_name: restaurant, p_branch_name: branch, p_full_name: name });
    setLoading(false); if(rpcError)return setError(rpcError.message); router.replace('/dashboard'); router.refresh();
  }
  return <AuthCard title="Create restaurant workspace" subtitle="Your account becomes the workspace owner.">
    {message ? <div className="space-y-4"><div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">{message}</div><button onClick={()=>router.push('/login')} className="font-semibold">Go to sign in</button></div> : <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm font-semibold">Owner name<input required value={name} onChange={e=>setName(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3" placeholder="Rahul Sharma" /></label>
      <label className="block text-sm font-semibold">Restaurant name<input required value={restaurant} onChange={e=>setRestaurant(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3" placeholder="My Restaurant" /></label>
      <label className="block text-sm font-semibold">First branch<input required value={branch} onChange={e=>setBranch(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3" /></label>
      <label className="block text-sm font-semibold">Email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3" /></label>
      <label className="block text-sm font-semibold">Password<input required minLength={8} type="password" value={password} onChange={e=>setPassword(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3" /></label>
      {error&&<p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full bg-slate-900 text-white">{loading?'Creating…':'Create workspace'}</Button>
    </form>}
  </AuthCard>;
}
