import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDailySales, buildPaymentMix, buildTopItems } from './report-aggregations.mjs';

test('builds zero-filled local-day buckets and sums paid_at amounts in integer paise', () => {
  const now = new Date(2026, 10, 8, 12, 0, 0);
  const todayMorning = new Date(2026, 10, 8, 9, 0, 0).toISOString();
  const todayEvening = new Date(2026, 10, 8, 10, 0, 0).toISOString();
  const yesterday = new Date(2026, 10, 7, 10, 0, 0).toISOString();
  const outsideWindow = new Date(2026, 10, 1, 10, 0, 0).toISOString();

  const result = buildDailySales([
    { status: 'PAID', paid_at: todayMorning, grand_total: '0.10' },
    { status: 'PAID', paid_at: todayEvening, grand_total: '0.20' },
    { status: 'PAID', paid_at: yesterday, grand_total: '12.34' },
    { status: 'OPEN', paid_at: todayMorning, grand_total: '99.00' },
    { status: 'PAID', paid_at: null, grand_total: '5.00' },
    { status: 'PAID', paid_at: outsideWindow, grand_total: '50.00' },
    { status: 'PAID', paid_at: 'not-a-date', grand_total: '7.00' },
  ], 7, now);

  assert.equal(result.length, 7);
  assert.equal(result.at(-1).sales, 0.3);
  assert.equal(result.at(-1).orders, 2);
  assert.equal(result.at(-2).sales, 12.34);
  assert.equal(result.at(-2).orders, 1);
  assert.equal(result[0].sales, 0);
  assert.equal(result[0].orders, 0);
});

test('rejects unsupported report ranges and invalid reference dates', () => {
  assert.throws(() => buildDailySales([], 14, new Date()), RangeError);
  assert.throws(() => buildDailySales([], 7, new Date('invalid')), TypeError);
});

test('groups best sellers once and preserves paise totals', () => {
  const result = buildTopItems([
    { item_name: 'Tea', quantity: '2', line_total: '0.10' },
    { item_name: 'Coffee', quantity: 1, line_total: '1.25' },
    { item_name: 'Tea', quantity: 1, line_total: '0.20' },
  ]);

  assert.deepEqual(result, [
    { name: 'Tea', quantity: 3, sales: 0.3 },
    { name: 'Coffee', quantity: 1, sales: 1.25 },
  ]);
});

test('validates top-item quantities and limits', () => {
  assert.throws(() => buildTopItems([{ item_name: 'Tea', quantity: 'bad', line_total: '1.00' }]), TypeError);
  assert.throws(() => buildTopItems([], -1), RangeError);
  assert.equal(buildTopItems([{ item_name: 'Tea', quantity: 1, line_total: '1.00' }], 0).length, 0);
});

test('payment mix sums completed partial transactions and excludes non-completed rows', () => {
  const result = buildPaymentMix([
    { payment_method: 'CASH', amount: '0.10', status: 'COMPLETED' },
    { payment_method: 'CASH', amount: '0.20', status: 'COMPLETED' },
    { payment_method: 'UPI', amount: '0.50', status: 'COMPLETED' },
    { payment_method: 'UPI', amount: '9.00', status: 'PENDING' },
  ]);

  assert.deepEqual(result, [['UPI', 0.5], ['CASH', 0.3]]);
});

test('attributes sales to paid_at when an order was created before the selected window', () => {
  const now = new Date(2026, 10, 8, 12, 0, 0);
  const oldCreatedAt = new Date(2026, 9, 20, 9, 0, 0).toISOString();
  const paidToday = new Date(2026, 10, 8, 9, 0, 0).toISOString();
  const paidAfterWindow = new Date(2026, 10, 9, 9, 0, 0).toISOString();

  const result = buildDailySales([
    {
      status: 'PAID',
      created_at: oldCreatedAt,
      paid_at: paidToday,
      grand_total: '125.50',
    },
    {
      status: 'PAID',
      created_at: new Date(2026, 10, 8, 8, 0, 0).toISOString(),
      paid_at: paidAfterWindow,
      grand_total: '900.00',
    },
  ], 7, now);

  assert.equal(result.at(-1).sales, 125.5);
  assert.equal(result.at(-1).orders, 1);
});
