'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { AuthCard } from '@/components/AuthCard';
import { Button } from '@/components/Button';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState(''); const [done, setDone] = useState(false); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setLoading(true); setError(''); const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` }); setLoading(false); if (error) return setError(error.message); setDone(true); }
  return <AuthCard title="Reset password" subtitle="We will email you a secure recovery link.">
    {done ? <div className="space-y-4"><div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Check your email for the password reset link.</div><Link href="/login" className="block text-center font-semibold">Back to sign in</Link></div> : <form onSubmit={submit} className="space-y-4"><label className="block text-sm font-semibold">Email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3" /></label>{error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<Button type="submit" disabled={loading} className="w-full bg-slate-900 text-white">{loading?'Sending…':'Send reset link'}</Button></form>}
  </AuthCard>;
}
