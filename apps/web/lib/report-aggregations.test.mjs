import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDailySales, buildPaymentMix, buildTopItems } from './report-aggregations.mjs';
import { DEFAULT_REPORT_TIME_ZONE, getReportWindow, getZonedDateKey, resolveReportTimeZone } from './report-date-time.mjs';

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


test('keeps calendar buckets continuous across leap day and year boundaries', () => {
  const leapDayNow = new Date(2024, 2, 1, 12, 0, 0);
  const leapResult = buildDailySales([
    { status: 'PAID', paid_at: new Date(2024, 1, 29, 12, 0, 0).toISOString(), grand_total: '10.00' },
    { status: 'PAID', paid_at: new Date(2024, 2, 1, 9, 0, 0).toISOString(), grand_total: '20.00' },
  ], 7, leapDayNow);

  assert.equal(leapResult.length, 7);
  assert.equal(leapResult.at(-2).sales, 10);
  assert.equal(leapResult.at(-2).orders, 1);
  assert.equal(leapResult.at(-1).sales, 20);
  assert.equal(leapResult.at(-1).orders, 1);

  const yearEndNow = new Date(2027, 0, 2, 12, 0, 0);
  const yearResult = buildDailySales([
    { status: 'PAID', paid_at: new Date(2026, 11, 31, 12, 0, 0).toISOString(), grand_total: '31.00' },
    { status: 'PAID', paid_at: new Date(2027, 0, 1, 12, 0, 0).toISOString(), grand_total: '1.00' },
  ], 7, yearEndNow);

  assert.equal(yearResult.length, 7);
  assert.equal(yearResult.at(-3).sales, 31);
  assert.equal(yearResult.at(-2).sales, 1);
});


test('report windows and daily buckets use Asia/Kolkata, not the browser timezone', () => {
  const now = new Date('2026-11-10T20:00:00.000Z'); // 11 Nov, 01:30 in India
  assert.equal(DEFAULT_REPORT_TIME_ZONE, 'Asia/Kolkata');
  assert.equal(getZonedDateKey(now), '2026-11-11');

  const window = getReportWindow(now, 7);
  assert.equal(window.startDateKey, '2026-11-05');
  assert.equal(window.from.toISOString(), '2026-11-04T18:30:00.000Z');
  assert.equal(window.to.toISOString(), now.toISOString());
});

test('attributes payments on either side of India midnight to the correct branch day', () => {
  const now = new Date('2026-11-11T00:15:00.000Z');
  const result = buildDailySales([
    { status: 'PAID', paid_at: '2026-11-10T18:29:59.999Z', grand_total: '10.00' },
    { status: 'PAID', paid_at: '2026-11-10T18:30:00.000Z', grand_total: '20.00' },
  ], 7, now, 'Asia/Kolkata');

  assert.equal(result.at(-2).sales, 10);
  assert.equal(result.at(-2).orders, 1);
  assert.equal(result.at(-1).sales, 20);
  assert.equal(result.at(-1).orders, 1);
});

test('rejects invalid IANA timezone identifiers for report windows', () => {
  assert.throws(
    () => getReportWindow(new Date('2026-11-11T00:00:00.000Z'), 7, 'Not/A_Timezone'),
    RangeError,
  );
});


test('resolves report timezone from the related company object or array', () => {
  assert.equal(resolveReportTimeZone({ timezone: 'Asia/Kolkata' }), 'Asia/Kolkata');
  assert.equal(resolveReportTimeZone([{ timezone: 'Asia/Dubai' }]), 'Asia/Dubai');
  assert.equal(resolveReportTimeZone(null), DEFAULT_REPORT_TIME_ZONE);
  assert.throws(() => resolveReportTimeZone({ timezone: 'Not/A_Timezone' }), RangeError);
});
