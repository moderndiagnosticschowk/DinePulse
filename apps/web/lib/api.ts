import { supabase } from './supabase';

const configuredBaseUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const baseUrl = configuredBaseUrl || (process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : '');

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!baseUrl) {
    throw new Error('API is not configured. Set NEXT_PUBLIC_API_URL to the public HTTPS URL of the Express API in your deployment environment.');
  }
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message ?? 'Request failed');
  return payload as T;
}
