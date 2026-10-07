'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AuthCard } from '@/components/AuthCard';
import { Button } from '@/components/Button';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    router.replace('/dashboard');
    router.refresh();
  }

  return <AuthCard title="Welcome back" subtitle="Sign in to your restaurant operations workspace.">
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm font-semibold">Email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:border-slate-900" placeholder="owner@example.com" /></label>
      <label className="block text-sm font-semibold">Password<input required type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:border-slate-900" placeholder="••••••••" /></label>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full bg-slate-900 text-white">{loading ? 'Signing in…' : 'Sign in'}</Button>
      <div className="flex justify-between text-sm"><Link href="/forgot-password" className="font-semibold text-slate-700">Forgot password?</Link><Link href="/onboarding" className="font-semibold text-slate-700">Create workspace</Link></div>
    </form>
  </AuthCard>;
}
