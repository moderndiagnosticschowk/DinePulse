export const DEFAULT_REPORT_TIME_ZONE: string;

export function getZonedDateKey(value: Date | string | number, timeZone?: string): string;
export function addCalendarDays(dateKey: string, amount: number): string;
export function startOfZonedDay(dateKey: string, timeZone?: string): Date;
export function getReportWindow(
  now: Date | string | number,
  range: 7 | 30 | 90,
  timeZone?: string
): {
  from: Date;
  to: Date;
  startDateKey: string;
  endDateKey: string;
  timeZone: string;
};
export function formatZonedDayLabel(dateKey: string, timeZone?: string): string;
export function resolveReportTimeZone(
  companyRelation:
    | { timezone?: string | null }
    | Array<{ timezone?: string | null }>
    | null
    | undefined,
  fallback?: string
): string;
