import assert from 'node:assert/strict';
import test from 'node:test';

import { formatINR, fromMinorUnits, toMinorUnits } from './report-money.mjs';

test('converts INR decimal strings to integer paise without float accumulation', () => {
  assert.equal(toMinorUnits('125.75'), 12575);
  assert.equal(toMinorUnits('0.10') + toMinorUnits('0.20'), 30);
  assert.equal(toMinorUnits(0.29), 29);
});

test('rounds values with more than two decimals using half-up paise rounding', () => {
  assert.equal(toMinorUnits('12.345'), 1235);
  assert.equal(toMinorUnits('-0.005'), -1);
});

test('converts integer paise back to rupees', () => {
  assert.equal(fromMinorUnits(12345), 123.45);
  assert.equal(fromMinorUnits(30), 0.3);
  assert.throws(() => fromMinorUnits(1.5), RangeError);
});

test('rejects malformed and unsafe monetary values', () => {
  assert.throws(() => toMinorUnits('NaN'), TypeError);
  assert.throws(() => toMinorUnits('Infinity'), TypeError);
  assert.throws(() => toMinorUnits('1e3'), TypeError);
  assert.throws(() => toMinorUnits('90071992547409.92'), RangeError);
});

test('formats INR with paise instead of rounding to whole rupees', () => {
  assert.equal(formatINR(0.5), '₹0.50');
  assert.equal(formatINR(123.45), '₹123.45');
  assert.equal(formatINR(1234.5), '₹1,234.50');
  assert.throws(() => formatINR(Number.NaN), TypeError);
});
