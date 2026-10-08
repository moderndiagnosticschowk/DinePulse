export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-950 text-sm font-black text-white shadow-sm">DP</div>
      <div>
        <div className="font-black leading-tight tracking-tight">DinePulse</div>
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Restaurant POS</div>
      </div>
    </div>
  );
}
