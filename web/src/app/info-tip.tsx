import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function Info({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const tipId = useId();
  const hover = () => matchMedia('(hover:hover) and (pointer:fine)').matches;
  const close = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const place = () => {
    if (!btn.current || !tip.current) return;
    const b = btn.current.getBoundingClientRect();
    const w = tip.current.offsetWidth;
    const h = tip.current.offsetHeight;
    let left = b.left;
    if (left + w > innerWidth - 8) left = b.right - w;
    left = Math.max(8, left);
    let top = b.bottom + 8;
    if (top + h > innerHeight - 8) top = Math.max(8, b.top - h - 8);
    setPos({ top, left });
  };
  useLayoutEffect(() => {
    if (open) place();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: PointerEvent) => {
      if (e.target !== btn.current) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', place, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', place);
    };
  }, [open]);
  return (
    <span className="info">
      <button
        ref={btn}
        type="button"
        className="info-dot"
        aria-label={`About ${label}`}
        aria-describedby={tipId}
        aria-expanded={open}
        onMouseEnter={() => {
          if (!hover()) return;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setOpen(true), 120);
        }}
        onMouseLeave={() => hover() && close()}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onClick={() => setOpen(true)}
      >
        i
      </button>
      {createPortal(
        <div
          ref={tip}
          id={tipId}
          role="tooltip"
          className="info-tip"
          data-open={open ? 'true' : 'false'}
          style={{ top: pos.top, left: pos.left }}
        >
          {children}
        </div>,
        document.body
      )}
    </span>
  );
}
