import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Icon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />, arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    back: <path d="m14 6-6 6 6 6M8 12h12" />, heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />,
    gift: <><path d="M3 8h18v4H3zM5 12v9h14v-9M12 8v13" /><path d="M12 8H7a3 3 0 1 1 3-3l2 3Zm0 0h5a3 3 0 1 0-3-3l-2 3Z" /></>,
    link: <><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0) scale(.92)" /></>,
    edit: <><path d="m16 3 5 5-12 12H4v-5L16 3ZM13 6l5 5" /></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />, check: <path d="m5 12 4 4L19 6" />, external: <><path d="M14 3h7v7M21 3l-11 11M11 3H4v17h17v-7" /></>,
    logout: <><path d="M10 3H4v18h6M10 12h11m-4-4 4 4-4 4" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3" /></>,
    sparkle: <><path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z" /></>,
    cup: <><path d="M5 7h12v7a6 6 0 0 1-12 0V7ZM17 8h2a3 3 0 0 1 0 6h-2M3 22h16M8 2v2M13 2v2" /></>,
    book: <><path d="M4 3h14a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V3ZM4 17h16M8 6v7M11 7h5M11 10h5" /></>,
    headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v8h5v-8H4ZM20 12h2v8h-5v-8h3Z" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.gift}</svg>;
}
export const focus = 'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#454b35]';
export const buttonClass = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#272a23] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#444a36] disabled:cursor-wait disabled:opacity-50 ${focus}`;
export const secondaryClass = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#d9d8cf] bg-transparent px-5 py-2.5 text-sm font-medium transition hover:bg-[#edede4] ${focus}`;
export function Button({ children, tone = 'dark', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'dark' | 'light' | 'yellow' | 'danger' }) {
  const toneClass = tone === 'light' ? secondaryClass : `${buttonClass} ${tone === 'yellow' ? '!bg-[#f3cc58] !text-[#272a23] hover:!bg-[#edc044]' : tone === 'danger' ? '!bg-[#a33d36] hover:!bg-[#85342e]' : ''}`;
  return <button type="button" {...props} className={`${toneClass} ${className}`}>{children}</button>;
}
export function Brand({ inverse = false }: { inverse?: boolean }) {
  return <Link to="/" aria-label="Wishlist — главная" className={`inline-flex items-center gap-2.5 rounded-sm text-[24px] font-semibold tracking-[-1.2px] ${focus} ${inverse ? 'text-[#fffdf7]' : 'text-[#292c24]'}`}><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f3cc58] text-[#292c24]"><Icon name="sparkle" className="h-6 w-6" /></span>wishlist<span className="-ml-2 text-[#b29949]">.</span></Link>;
}
export function Modal({ title, children, onClose, wide = false, busy = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); const heading = useId();
  useEffect(() => { const dialog = ref.current!; const trigger = document.activeElement as HTMLElement | null; dialog.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { dialog.close(); document.body.style.overflow = previous; trigger?.focus(); }; }, []);
  return <dialog ref={ref} aria-labelledby={heading} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} onClick={e => { if (!busy && e.target === ref.current) onClose(); }} className={`m-auto max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-3xl border border-[#ddddd0] bg-[#fffef9] p-6 text-[#292c24] shadow-xl backdrop:bg-[#20251c]/45 sm:p-8 ${wide ? 'max-w-xl' : 'max-w-md'}`}><div className="mb-6 flex items-start justify-between gap-4"><h2 id={heading} className="font-[Georgia] text-3xl leading-tight">{title}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Закрыть" className={`-mr-2 -mt-2 rounded-full p-2 hover:bg-[#f0f0e7] ${focus}`}><Icon name="close" /></button></div>{children}</dialog>;
}
export const inputClass = `mt-2 min-h-12 w-full rounded-xl border border-[#d9dbce] bg-white px-4 py-3 text-base outline-none placeholder:text-[#999b8f] focus:border-[#565e42] focus:ring-2 focus:ring-[#78865a]/15`;
export function Field({ label, required, children, hint }: { label: string; required?: boolean; children: ReactNode; hint?: string }) { return <label className="block text-sm font-medium">{label}{!required && <span className="ml-2 font-normal text-[#878a7b]">необязательно</span>}{children}{hint && <span className="mt-1.5 block text-xs font-normal leading-relaxed text-[#73786a]">{hint}</span>}</label>; }
export function ErrorMessage({ children }: { children: ReactNode }) { return children ? <p role="alert" className="rounded-xl bg-[#f9e9e4] px-4 py-3 text-sm leading-relaxed text-[#8f372d]">{children}</p> : null; }
export function CopyLink({ value, label = 'Скопировать ссылку' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false); const [manual, setManual] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setManual(true); } }
  return <div className="space-y-3"><Button tone="light" onClick={copy} className="w-full"><Icon name={copied ? 'check' : 'link'} />{copied ? 'Ссылка скопирована' : label}</Button><span role="status" className="sr-only">{copied ? 'Ссылка скопирована' : ''}</span>{manual && <label className="block text-xs text-[#68705e]">Скопируйте ссылку вручную<input readOnly value={value} onFocus={e => e.target.select()} className={inputClass} /></label>}</div>;
}
export function EmptyState({ title, text, children, icon = 'gift' }: { title: string; text: string; children?: ReactNode; icon?: string }) { return <div className="rounded-3xl border border-dashed border-[#cdd0c1] px-6 py-14 text-center"><span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#e8eddf] text-[#5c684c]"><Icon name={icon} className="h-7 w-7" /></span><h2 className="font-[Georgia] text-3xl">{title}</h2><p className="mx-auto mb-6 mt-3 max-w-sm text-sm leading-6 text-[#73786a]">{text}</p>{children}</div>; }
export function GiftArt({ color = 0, className = '' }: { color?: number; className?: string }) {
  const palettes = ['bg-[#e7eadb] text-[#63704e]', 'bg-[#f0dcd2] text-[#b5745f]', 'bg-[#e2dff0] text-[#8b80ac]'];
  return <div className={`relative isolate flex items-center justify-center overflow-hidden ${palettes[color % 3]} ${className}`} aria-hidden="true"><svg viewBox="0 0 280 180" className="h-full w-full max-w-[340px] overflow-visible" fill="none"><circle cx="140" cy="96" r="69" fill="currentColor" opacity=".08" /><path d="m40 35 3 9 9 3-9 3-3 9-3-9-9-3 9-3 3-9ZM236 119l3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" fill="currentColor" /><g transform={color === 1 ? 'translate(140 90) rotate(9) translate(-140 -90)' : 'translate(140 90) rotate(-7) translate(-140 -90)'}><rect x="85" y="83" width="112" height="73" rx="3" fill="currentColor" opacity=".85" /><rect x="77" y="66" width="128" height="27" rx="3" fill="currentColor" /><path d="M133 66h18v90h-18z" fill="#fff8e7" /><path d="M142 65c-24-4-51-12-41-29 11-20 37 7 41 29Zm0 0c24-4 51-12 41-29-11-20-37 7-41 29Z" stroke="#fff8e7" strokeWidth="7" /><path d="m140 66-16 31m19-31 18 28" stroke="#fff8e7" strokeWidth="5" /></g><path d="m58 128 8-8m153-84 5-8m-8 22 11 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></div>;
}
