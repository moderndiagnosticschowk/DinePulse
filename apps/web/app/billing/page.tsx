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
  payment?: { amount: number | string } | null;
};
type PendingPaymentAttempt = {
  idempotencyKey: string;
  paymentMethod: PaymentMethod;
  amount: number | null;
};

const paymentMethods: PaymentMethod[] = ['CASH', 'UPI', 'CARD'];

export default function BillingPage() {
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const [branchId, setBranchId] = useState('');
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
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

    const rawAmount = (paymentAmounts[order.id] ?? '').trim();
    let requestedAmount: number | null = null;
    if (rawAmount !== '') {
      const parsedAmount = Number(rawAmount);
      const roundedAmount = Math.round((parsedAmount + Number.EPSILON) * 100) / 100;
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        setMessage('Enter a payment amount greater than ₹0, or leave it blank to collect the full balance.');
        return;
      }
      if (Math.abs(parsedAmount - roundedAmount) > 0.000001 || roundedAmount > order.amount_due) {
        setMessage(`Enter an amount up to ₹${order.amount_due.toFixed(2)} with no more than two decimal places.`);
        return;
      }
      requestedAmount = roundedAmount;
    }

    setPayingOrderId(order.id);
    setMessage('');
    const storageKey = `dinepulse:payment-idempotency:${order.id}`;

    try {
      // Bind the idempotency key to the original method and amount. If the response
      // was lost, a retry must reproduce the exact payment attempt.
      const storedAttempt = sessionStorage.getItem(storageKey);
      let attempt: PendingPaymentAttempt;
      if (storedAttempt) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(storedAttempt);
        } catch {
          parsed = null;
        }
        if (!parsed || typeof parsed !== 'object') {
          setMessage('An older payment attempt is unresolved. Verify the payment history before starting another payment.');
          return;
        }
        const candidate = parsed as Partial<PendingPaymentAttempt>;
        if (typeof candidate.idempotencyKey !== 'string'
          || !paymentMethods.includes(candidate.paymentMethod as PaymentMethod)) {
          setMessage('The saved payment attempt is invalid. Verify the payment history before starting another payment.');
          return;
        }
        // Previous versions always sent p_amount=null, so a missing amount field
        // safely represents a full-balance attempt during this compatibility window.
        const savedAmount = candidate.amount === undefined ? null : candidate.amount;
        if (savedAmount !== null
          && (typeof savedAmount !== 'number' || !Number.isFinite(savedAmount) || savedAmount <= 0)) {
          setMessage('The saved payment amount is invalid. Verify the payment history before starting another payment.');
          return;
        }
        attempt = {
          idempotencyKey: candidate.idempotencyKey,
          paymentMethod: candidate.paymentMethod as PaymentMethod,
          amount: savedAmount,
        };
        if (attempt.paymentMethod !== method || attempt.amount !== requestedAmount) {
          const savedAmountLabel = attempt.amount === null ? 'the full outstanding balance' : `₹${attempt.amount.toFixed(2)}`;
          setMessage(`A previous ${attempt.paymentMethod} attempt for ${savedAmountLabel} is unresolved. Retry with the same method and amount; changing either is blocked to prevent duplicate charges.`);
          return;
        }
      } else {
        attempt = {
          idempotencyKey: crypto.randomUUID(),
          paymentMethod: method,
          amount: requestedAmount,
        };
        sessionStorage.setItem(storageKey, JSON.stringify(attempt));
      }

      const { data, error } = await supabase.rpc('settle_order_payment', {
        p_order_id: order.id,
        p_branch_id: branchId,
        p_payment_method: attempt.paymentMethod,
        p_idempotency_key: attempt.idempotencyKey,
        p_amount: attempt.amount,
        p_reference_number: null,
      });
      if (error) throw error;

      // The RPC response confirms the payment transaction committed. Clear the
      // pending key now, but keep refresh failures separate from payment failures.
      sessionStorage.removeItem(storageKey);
      setPaymentAmounts((current) => ({ ...current, [order.id]: '' }));
      const result = data as SettlementResult;
      const chargedAmount = Number(result.payment?.amount ?? attempt.amount ?? order.amount_due);
      const successMessage = result.paid
        ? `Order #${order.order_number ?? ''} settled. Payment received: ₹${chargedAmount.toFixed(2)} by ${method}.`
        : `Payment of ₹${chargedAmount.toFixed(2)} recorded. Remaining balance: ₹${Number(result.remaining_amount).toFixed(2)}.`;
      setMessage(successMessage);
      try {
        await load();
      } catch {
        setMessage(`${successMessage} The payment is saved, but the bill list could not refresh. Refresh this page; do not submit the payment again.`);
      }
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
        <p className="mt-1 text-sm text-slate-500">Collect full or partial payment and close open orders.</p>

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
              <label className="mt-4 block text-xs font-semibold text-slate-600">
                Amount to collect (₹)
                <input
                  aria-label={`Payment amount for order ${order.order_number ?? order.id}`}
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max={order.amount_due}
                  step="0.01"
                  value={paymentAmounts[order.id] ?? ''}
                  onChange={(event) => setPaymentAmounts((current) => ({ ...current, [order.id]: event.target.value }))}
                  placeholder={order.amount_due.toFixed(2)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-slate-500"
                />
              </label>
              <p className="mt-1 text-xs text-slate-400">Leave blank to collect the full outstanding balance. Enter a smaller amount for a partial payment.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {paymentMethods.map((method) => (
                  <button
                    key={method}
                    type="button"
                    disabled={payingOrderId !== null || order.amount_due <= 0}
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
