import { fromMinorUnits, toMinorUnits } from './report-money.mjs';

function localDayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildDailySales(paidOrders, range, now = new Date()) {
  if (![7, 30, 90].includes(range)) {
    throw new RangeError('Report range must be 7, 30 or 90 days');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Report reference time must be a valid Date');
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const buckets = new Map();

  for (let offset = range - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(day.getDate() - offset);
    buckets.set(localDayKey(day), {
      label: day.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      salesMinorUnits: 0,
      orders: 0,
    });
  }

  // One pass over paid orders: O(range + orders), rather than filtering all
  // orders once for every displayed day.
  for (const order of paidOrders) {
    if (order.status !== undefined && order.status !== 'PAID') continue;
    if (!order.paid_at) continue;
    const paidAt = new Date(order.paid_at);
    if (!Number.isFinite(paidAt.getTime())) continue;
    const bucket = buckets.get(localDayKey(paidAt));
    if (!bucket) continue;
    bucket.salesMinorUnits += toMinorUnits(order.grand_total);
    bucket.orders += 1;
  }

  return [...buckets.values()].map(bucket => ({
    label: bucket.label,
    sales: fromMinorUnits(bucket.salesMinorUnits),
    orders: bucket.orders,
  }));
}

export function buildTopItems(items, limit = 8) {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError('Top-item limit must be a non-negative integer');
  }

  const grouped = new Map();
  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity)) {
      throw new TypeError('Top-item quantity must be finite');
    }
    const name = String(item.item_name ?? '');
    const existing = grouped.get(name) ?? { quantity: 0, salesMinorUnits: 0 };
    existing.quantity += quantity;
    existing.salesMinorUnits += toMinorUnits(item.line_total);
    grouped.set(name, existing);
  }

  return [...grouped.entries()]
    .map(([name, data]) => ({
      name,
      quantity: data.quantity,
      sales: fromMinorUnits(data.salesMinorUnits),
    }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, limit);
}

export function buildPaymentMix(payments) {
  const grouped = new Map();
  for (const payment of payments) {
    if (payment.status !== undefined && payment.status !== 'COMPLETED') continue;
    const method = String(payment.payment_method ?? 'UNKNOWN');
    grouped.set(method, (grouped.get(method) ?? 0) + toMinorUnits(payment.amount));
  }

  return [...grouped.entries()]
    .map(([method, amountMinorUnits]) => [method, fromMinorUnits(amountMinorUnits)])
    .sort((a, b) => b[1] - a[1]);
}
