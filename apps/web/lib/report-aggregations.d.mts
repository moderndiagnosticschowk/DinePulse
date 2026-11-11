export type ReportOrder = {
  paid_at: string | null;
  grand_total: number | string;
  status?: string;
};
export type ReportItem = {
  item_name: string;
  quantity: number | string;
  line_total: number | string;
};
export type ReportPayment = {
  payment_method: string;
  amount: number | string;
  status?: string;
};
export type DailySalesPoint = { label: string; sales: number; orders: number };
export type TopItem = { name: string; quantity: number; sales: number };
export type PaymentMixEntry = [method: string, amount: number];

export function buildDailySales(
  paidOrders: ReportOrder[],
  range: 7 | 30 | 90,
  now?: Date,
  timeZone?: string
): DailySalesPoint[];
export function buildTopItems(items: ReportItem[], limit?: number): TopItem[];
export function buildPaymentMix(payments: ReportPayment[]): PaymentMixEntry[];
