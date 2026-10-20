import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/*
 * The one fixed element on the page (DESIGN.md "Grid and rhythm"): bottom right, carrying real
 * data. The shell owns the slot; a page fills it by rendering <Readout>. It steps aside on
 * scroll down and returns on scroll up (motion/index.ts, `html.readout-away`).
 */
export const ReadoutSlot = createContext<HTMLElement | null>(null);

export function Readout({ children, label }: { children: ReactNode; label?: string }) {
  const slot = useContext(ReadoutSlot);
  if (!slot) return null;
  return createPortal(
    <div className="readout__body" aria-label={label}>
      {children}
    </div>,
    slot,
  );
}
