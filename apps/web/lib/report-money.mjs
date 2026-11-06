export function toMinorUnits(value) {
  const raw = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) {
    throw new TypeError(`Invalid monetary value: ${raw}`);
  }

  const [, sign, wholeText, fractionText = ''] = match;
  const whole = Number(wholeText);
  if (!Number.isSafeInteger(whole)) {
    throw new RangeError('Monetary value exceeds the safe integer range');
  }

  const hundredths = Number((fractionText + '00').slice(0, 2));
  const roundUp = Number(fractionText[2] ?? '0') >= 5;
  const minorUnits = whole * 100 + hundredths + (roundUp ? 1 : 0);
  if (!Number.isSafeInteger(minorUnits)) {
    throw new RangeError('Monetary value exceeds the safe integer range');
  }

  return sign === '-' ? -minorUnits : minorUnits;
}

export function fromMinorUnits(minorUnits) {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new RangeError('Minor-unit total must be a safe integer');
  }
  return minorUnits / 100;
}

export function formatINR(value) {
  if (!Number.isFinite(value)) {
    throw new TypeError('INR display value must be finite');
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
