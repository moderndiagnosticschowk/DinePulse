-- Phase 12: support branch/date-filtered reports and paginated child rows.
-- Apply to a disposable/staging database first. Run during a low-traffic window:
-- regular CREATE INDEX statements take a table lock while each index is built.

create index if not exists idx_orders_branch_created_report
  on public.orders (branch_id, created_at desc, id asc);

create index if not exists idx_orders_branch_paid_at_report
  on public.orders (branch_id, paid_at desc, id asc)
  where status = 'PAID' and paid_at is not null;

create index if not exists idx_order_items_order_report
  on public.order_items (order_id, id);

create index if not exists idx_payments_paid_at_report
  on public.payments (paid_at desc, id asc)
  include (order_id, payment_method, amount)
  where status = 'COMPLETED' and paid_at is not null;
