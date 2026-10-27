import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { teamLogo } from '../lib/teams';

export type SelectItem = {
  value: string;
  name: string;
  code?: string;
  detail?: string;
  team?: string | null;
  colour?: string | null;
};
function Item({ item }: { item: SelectItem }) {
  const logo = item.team ? teamLogo(item.team) : null;
  return (
    <>
      {item.team && <span className="select-team-stripe" />}
      {logo && <img className="select-logo" src={logo} alt="" loading="lazy" width="26" height="26" />}
      <span className="select-copy">
        <span className="select-name">{item.name}</span>
        {item.detail && <span className="select-detail">{item.detail}</span>}
      </span>
      {item.code && <span className="select-code">{item.code}</span>}
    </>
  );
}
// Keep focus on the select-only combobox: arrows preview, Enter commits, Escape cancels.
// Options carry identity, not inferred performance; names remain the accessible value.
export function SessionSelect({
  label,
  value,
  items,
  onChange,
  pending = false,
}: {
  label: string;
  value: string;
  items: SelectItem[];
  onChange: (value: string) => void;
  pending?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [above, setAbove] = useState(false);
  const search = useRef({ text: '', at: 0 });
  const selected = Math.max(
    0,
    items.findIndex((i) => i.value === value)
  );
  const item = items[selected];
  function show(index = selected) {
    if (!items.length) return;
    const r = trigger.current?.getBoundingClientRect();
    setAbove(!!r && innerHeight - r.bottom < 200 && r.top > 250);
    setActive(index);
    setOpen(true);
  }
  function commit(index: number) {
    if (items[index]) onChange(items[index].value);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (open) {
      const row = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
      if (row && list.current) {
        const box = list.current;
        if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
        else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight)
          box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
      }
    }
  }, [active, open]);
  function keys(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : Math.max(
                0,
                Math.min(items.length - 1, (open ? active : selected) + (e.key === 'ArrowDown' ? 1 : -1))
              );
      if (open) setActive(next);
      else show(e.key === 'Home' || e.key === 'End' ? next : selected);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) commit(active);
      else show();
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const now = Date.now();
      const repeated = search.current.text.toLowerCase() === e.key.toLowerCase();
      const text = now - search.current.at < 600 && !repeated ? search.current.text + e.key : e.key;
      search.current = { text, at: now };
      const term = text.toLowerCase();
      const start = open ? active : selected;
      const indexes = items.map((_, i) => (start + 1 + i) % items.length);
      const found = indexes.find((i) =>
        [items[i].name, items[i].code ?? '', items[i].team ?? ''].some((s) =>
          s.toLowerCase().startsWith(term)
        )
      );
      if (found !== undefined) {
        if (open) setActive(found);
        else show(found);
      }
    }
  }
  return (
    <div
      className={`session-select ${open ? 'is-open' : ''} ${above ? 'opens-above' : ''}`}
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      style={{ '--team': item?.colour ?? '#b7b7af' } as CSSProperties}
    >
      <span className="select-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className="select-trigger"
        disabled={!items.length}
        aria-busy={pending || undefined}
        role="combobox"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        onKeyDown={keys}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span id={`${id}-value`} className="select-value">
          {item ? (
            <Item item={item} />
          ) : (
            <span className="select-name">{pending ? 'Loading…' : 'No options available'}</span>
          )}
        </span>
        <svg className="select-chevron" width="12" height="8" viewBox="0 0 12 8" aria-hidden="true">
          <path d="m1 1 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      {open && (
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-labelledby={`${id}-label`}
          className="select-options"
        >
          {items.map((option, i) => (
            <div
              key={option.value}
              id={`${id}-option-${i}`}
              role="option"
              aria-selected={option.value === value}
              aria-label={`${option.name}${option.detail ? ', ' + option.detail : ''}${option.code ? ', ' + option.code : ''}`}
              className={`select-option ${active === i ? 'is-active' : ''}`}
              data-index={i}
              style={{ '--team': option.colour ?? '#b7b7af' } as CSSProperties}
              onPointerMove={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                commit(i);
                trigger.current?.focus({ preventScroll: true });
              }}
            >
              <Item item={option} />
              <span className="select-check" aria-hidden="true">
                {option.value === value ? '✓' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
