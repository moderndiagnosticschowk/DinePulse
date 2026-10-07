export function Button({ children, type = 'button', disabled = false, className = '', onClick }: { children: React.ReactNode; type?: 'button'|'submit'; disabled?: boolean; className?: string; onClick?: () => void }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`rounded-xl px-4 py-2.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${className || 'bg-slate-900 text-white hover:bg-slate-800'}`}>{children}</button>;
}
