'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AuthCard } from '@/components/AuthCard';
import { Button } from '@/components/Button';

export default function ResetPasswordPage() {
  const router = useRouter(); const [password,setPassword]=useState(''); const [confirm,setConfirm]=useState(''); const [ready,setReady]=useState(false); const [error,setError]=useState(''); const [done,setDone]=useState(false);
  useEffect(()=>{ supabase.auth.getSession().then(({data})=>setReady(Boolean(data.session))); },[]);
  async function submit(e: FormEvent){e.preventDefault();setError('');if(password.length<8)return setError('Password must be at least 8 characters.');if(password!==confirm)return setError('Passwords do not match.');const {error}=await supabase.auth.updateUser({password});if(error)return setError(error.message);setDone(true);setTimeout(()=>router.replace('/dashboard'),500);}
  return <AuthCard title="Set a new password" subtitle="Choose a strong password for your account.">{!ready ? <p className="text-sm text-slate-500">Open this page from the password reset email.</p> : done ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">Password updated. Redirecting…</p> : <form onSubmit={submit} className="space-y-4"><input type="password" required minLength={8} value={password} onChange={e=>setPassword(e.target.value)} className="w-full rounded-xl border p-3" placeholder="New password" /><input type="password" required minLength={8} value={confirm} onChange={e=>setConfirm(e.target.value)} className="w-full rounded-xl border p-3" placeholder="Confirm password" />{error&&<p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<Button type="submit" className="w-full bg-slate-900 text-white">Update password</Button></form>}</AuthCard>;
}
