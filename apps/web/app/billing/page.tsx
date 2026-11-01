'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type PaymentMethod = 'CASH' | 'UPI' | 'CARD';
type BillingOrder = {
  id: string;
  order_number: number | null;
  grand_total: number | string;
  amount_due: number;
  status: string;
  created_at: string;
};

type SettlementResult = {
  paid: boolean;
  duplicate: boolean;
  remaining_amount: number | string;
};

const paymentMethods: PaymentMethod[] = ['CASH', 'UPI', 'CARD'];

export default function BillingPage() {
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const [branchId, setBranchId] = useState('');
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setOrders([]);
      setBranchId('');
      setMessage('Please sign in to use billing.');
      return;
    }

    const { data: memberships, error: membershipError } = await supabase
      .from('branch_memberships')
      .select('branch_id')
      .eq('user_id', user.id)
      .eq('is_active', true);
    if (membershipError) throw membershipError;

    const availableBranchIds = (memberships ?? []).map((membership) => membership.branch_id);
    const savedBranchId = localStorage.getItem('dinepulse:active-branch-id');
    const selectedBranchId = availableBranchIds.includes(savedBranchId ?? '')
      ? savedBranchId as string
      : availableBranchIds[0];

    if (!selectedBranchId) {
      setOrders([]);
      setBranchId('');
      setMessage('No active restaurant branch is linked to this account.');
      return;
    }

    setBranchId(selectedBranchId);
    const { data: orderRows, error: ordersError } = await supabase
      .from('orders')
      .select('id,order_number,grand_total,status,created_at')
      .eq('branch_id', selectedBranchId)
      .in('status', ['OPEN', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'SERVED'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (ordersError) throw ordersError;

    const ids = (orderRows ?? []).map((order) => order.id);
    const paidByOrder = new Map<string, number>();
    if (ids.length) {
      const { data: paymentRows, error: paymentsError } = await supabase
        .from('payments')
        .select('order_id,amount')
        .in('order_id', ids)
        .eq('status', 'COMPLETED');
      if (paymentsError) throw paymentsError;
      for (const payment of paymentRows ?? []) {
        paidByOrder.set(
          payment.order_id,
          (paidByOrder.get(payment.order_id) ?? 0) + Number(payment.amount),
        );
      }
    }

    setOrders((orderRows ?? []).map((order) => ({
      ...order,
      amount_due: Math.max(Number(order.grand_total) - (paidByOrder.get(order.id) ?? 0), 0),
    })) as BillingOrder[]);
    setMessage('');
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : 'Unable to load billing orders.');
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function pay(order: BillingOrder, method: PaymentMethod) {
    if (payingOrderId) return;
    if (!branchId) {
      setMessage('Select an active branch before collecting payment.');
      return;
    }

    setPayingOrderId(order.id);
    const storageKey = `dinepulse:payment-idempotency:${order.id}`;

    try {
      // Keep the same key after a timeout/error so a committed payment can be safely retried.
      const idempotencyKey = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey, idempotencyKey);

      const { data, error } = await supabase.rpc('settle_order_payment', {
        p_order_id: order.id,
        p_branch_id: branchId,
        p_payment_method: method,
        p_idempotency_key: idempotencyKey,
        p_amount: null,
        p_reference_number: null,
      });
      if (error) throw error;

      sessionStorage.removeItem(storageKey);
      const result = data as SettlementResult;
      setMessage(result.paid
        ? `Order #${order.order_number ?? ''} settled by ${method}.`
        : `Payment recorded. Remaining balance: ₹${Number(result.remaining_amount).toFixed(2)}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Payment could not be completed. Retry safely.');
    } finally {
      setPayingOrderId(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold">Billing & Payments</h1>
        <p className="mt-1 text-sm text-slate-500">Collect payment and close open orders.</p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {orders.map((order) => (
            <div key={order.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <div className="flex justify-between gap-3">
                <span className="font-bold">Order #{order.order_number ?? order.id.slice(0, 8)}</span>
                <span className="text-lg font-bold">₹{order.amount_due.toFixed(2)} due</span>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                {order.status} · Total ₹{Number(order.grand_total).toFixed(2)}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {paymentMethods.map((method) => (
                  <button
                    key={method}
                    type="button"
                    disabled={payingOrderId !== null}
                    onClick={() => void pay(order, method)}
                    className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {payingOrderId === order.id ? 'Processing…' : method === 'CASH' ? 'Cash' : method}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {orders.length === 0 && !message && (
          <div className="mt-6 rounded-xl bg-white p-5 text-sm text-slate-500">No billable orders.</div>
        )}
        {message && <div role="status" className="mt-5 rounded-xl bg-slate-900 p-3 text-sm text-white">{message}</div>}
      </div>
    </main>
  );
}
