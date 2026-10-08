import Link from 'next/link';

const features = [
  ['01', 'POS Billing', 'Fast order entry, discounts and payments without slowing the counter.'],
  ['02', 'Tables & KOT', 'Keep floor service and kitchen tickets synchronized in real time.'],
  ['03', 'Inventory', 'Track stock, recipes, purchases, suppliers and low-stock alerts.'],
  ['04', 'Operations', 'Bring your restaurant team into one focused workspace.'],
];

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f5f7fb] text-slate-950">
      <div className="pointer-events-none absolute -left-32 top-20 h-72 w-72 rounded-full bg-slate-300/30 blur-3xl dp-pulse-soft" />
      <div className="pointer-events-none absolute right-[-120px] top-[-80px] h-96 w-96 rounded-full bg-slate-200/60 blur-3xl dp-float" />

      <header className="dp-glass sticky top-0 z-30 border-b border-slate-200/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3 dp-fade-in">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-sm font-black text-white shadow-lg shadow-slate-950/15">DP</div>
            <div>
              <div className="font-black tracking-tight">DinePulse</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Restaurant OS</div>
            </div>
          </div>
          <Link href="/login" className="dp-interactive rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-slate-950/10">Sign in</Link>
        </div>
      </header>

      <section className="relative mx-auto max-w-7xl px-5 pb-20 pt-20 lg:px-8 lg:pb-28 lg:pt-28">
        <div className="max-w-4xl dp-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Restaurant operations platform
          </span>
          <h1 className="mt-7 text-5xl font-black leading-[.98] tracking-[-.04em] sm:text-6xl lg:text-8xl">
            Your restaurant.
            <br />
            <span className="text-slate-400">One pulse.</span>
          </h1>
          <p className="mt-7 max-w-2xl text-base leading-8 text-slate-500 sm:text-lg">
            DinePulse connects billing, tables, kitchen KOT, menu, inventory and purchasing into one fast restaurant workspace.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/login" className="dp-interactive rounded-2xl bg-slate-950 px-6 py-3.5 text-sm font-black text-white shadow-xl shadow-slate-950/15">Open DinePulse <span className="ml-2">→</span></Link>
            <Link href="/onboarding" className="dp-interactive rounded-2xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-black text-slate-700 shadow-sm">Create workspace</Link>
          </div>
        </div>

        <div className="relative mt-16 overflow-hidden rounded-[32px] bg-slate-950 p-5 shadow-2xl shadow-slate-950/20 dp-scale-in dp-delay-2 sm:p-7">
          <div className="dp-shimmer absolute inset-0" />
          <div className="relative grid gap-4 lg:grid-cols-[1.4fr_.6fr]">
            <div className="rounded-2xl border border-white/10 bg-white/[.06] p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Live workspace</span>
                <span className="flex items-center gap-2 text-xs font-bold text-emerald-400"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Connected</span>
              </div>
              <div className="mt-8 grid grid-cols-3 gap-3">
                {['POS', 'KOT', 'Stock'].map((item, i) => (
                  <div key={item} className="rounded-2xl bg-white/[.07] p-4">
                    <p className="text-xs font-bold text-slate-400">{item}</p>
                    <p className="mt-2 text-2xl font-black text-white">{i === 0 ? '24' : i === 1 ? '08' : '92%'}</p>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-3/4 rounded-full bg-white/70" /></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[.06] p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Built for speed</p>
              <p className="mt-4 text-3xl font-black text-white">Less clicking.</p>
              <p className="mt-1 text-3xl font-black text-slate-400">More serving.</p>
              <p className="mt-5 text-sm leading-6 text-slate-400">A focused interface for busy restaurant teams.</p>
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(([number, title, desc], index) => (
            <div key={title} className={`dp-card rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dp-fade-up dp-delay-${index + 2}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-300">{number}</span>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-sm font-black">+</span>
              </div>
              <h2 className="mt-7 font-black">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{desc}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}