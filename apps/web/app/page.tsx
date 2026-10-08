import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f5f7fb] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-950 text-sm font-black text-white">DP</div>
            <div>
              <div className="font-black tracking-tight">DinePulse</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Restaurant POS</div>
            </div>
          </div>
          <Link href="/login" className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white">Sign in</Link>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
        <div className="max-w-4xl">
          <span className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-500">
            Restaurant operations platform
          </span>
          <h1 className="mt-6 text-5xl font-black tracking-tight sm:text-6xl lg:text-7xl">
            Run your restaurant with <span className="text-slate-500">DinePulse.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-500">
            POS billing, tables, orders, kitchen KOT, menu management, inventory, purchases and suppliers in one connected workspace.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/login" className="rounded-2xl bg-slate-950 px-6 py-3.5 text-sm font-black text-white shadow-lg">Open DinePulse →</Link>
            <Link href="/onboarding" className="rounded-2xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-black text-slate-700">Create workspace</Link>
          </div>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['POS Billing', 'Fast order entry and payment'],
            ['Tables & Orders', 'Track dining floor and tickets'],
            ['Kitchen / KOT', 'Keep kitchen work in sync'],
            ['Inventory', 'Stock, purchases and suppliers'],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-lg font-black">DP</div>
              <h2 className="mt-5 font-black">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{desc}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
