export const DEFAULT_REPORT_TIME_ZONE = 'Asia/Kolkata';

function asValidDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Report date must be valid');
  }
  return date;
}

function dateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

export function getZonedDateKey(value, timeZone = DEFAULT_REPORT_TIME_ZONE) {
  const date = asValidDate(value);
  const { year, month, day } = dateParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addCalendarDays(dateKey, amount) {
  if (!Number.isInteger(amount)) {
    throw new TypeError('Calendar-day offset must be an integer');
  }
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(dateKey);
  if (!match) throw new TypeError('Date key must use YYYY-MM-DD');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + amount));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

// Convert a branch-local midnight to its UTC instant without relying on the
// browser's timezone. The current India rollout uses Asia/Kolkata (no DST).
export function startOfZonedDay(dateKey, timeZone = DEFAULT_REPORT_TIME_ZONE) {
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(dateKey);
  if (!match) throw new TypeError('Date key must use YYYY-MM-DD');

  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 0,
    minute: 0,
    second: 0,
  };
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day);
  let candidate = targetAsUtc;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  // Iteratively correct the UTC guess by the timezone's offset at that instant.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const values = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map(part => [part.type, part.value]),
    );
    const representedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    const correction = targetAsUtc - representedAsUtc;
    if (correction === 0) return new Date(candidate);
    candidate += correction;
  }

  throw new RangeError(`Could not resolve midnight for ${dateKey} in ${timeZone}`);
}

export function getReportWindow(now, range, timeZone = DEFAULT_REPORT_TIME_ZONE) {
  const current = asValidDate(now);
  if (![7, 30, 90].includes(range)) {
    throw new RangeError('Report range must be 7, 30 or 90 days');
  }
  const endDateKey = getZonedDateKey(current, timeZone);
  const startDateKey = addCalendarDays(endDateKey, -(range - 1));
  return {
    from: startOfZonedDay(startDateKey, timeZone),
    to: current,
    startDateKey,
    endDateKey,
    timeZone,
  };
}

export function formatZonedDayLabel(dateKey, timeZone = DEFAULT_REPORT_TIME_ZONE) {
  return startOfZonedDay(dateKey, timeZone).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone,
  });
}
