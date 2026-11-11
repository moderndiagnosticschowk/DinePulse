import { fromMinorUnits, toMinorUnits } from './report-money.mjs';
import {
  DEFAULT_REPORT_TIME_ZONE,
  addCalendarDays,
  formatZonedDayLabel,
  getZonedDateKey,
} from './report-date-time.mjs';

export function buildDailySales(
  paidOrders,
  range,
  now = new Date(),
  timeZone = DEFAULT_REPORT_TIME_ZONE,
) {
  if (![7, 30, 90].includes(range)) {
    throw new RangeError('Report range must be 7, 30 or 90 days');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Report reference time must be a valid Date');
  }

  const todayKey = getZonedDateKey(now, timeZone);
  const buckets = new Map();

  for (let offset = range - 1; offset >= 0; offset -= 1) {
    const dayKey = addCalendarDays(todayKey, -offset);
    buckets.set(dayKey, {
      label: formatZonedDayLabel(dayKey, timeZone),
      salesMinorUnits: 0,
      orders: 0,
    });
  }

  // One pass over paid orders: O(range + orders), using the branch timezone
  // rather than the viewer's browser timezone for date attribution.
  for (const order of paidOrders) {
    if (order.status !== undefined && order.status !== 'PAID') continue;
    if (!order.paid_at) continue;
    const paidAt = new Date(order.paid_at);
    if (!Number.isFinite(paidAt.getTime())) continue;
    const bucket = buckets.get(getZonedDateKey(paidAt, timeZone));
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
