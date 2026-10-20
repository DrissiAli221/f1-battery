import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "../motion";

/*
 * The one fixed element on the page (DESIGN.md "Grid and rhythm"): bottom right, carrying real
 * data. The shell owns the slot; a page fills it by rendering <Readout>.
 *
 * It must never print over content, so it is shown only while the page's stage is on screen:
 * the element marked `data-stage` (the landing's hero, the explorer's instrument), or the
 * page's first block when none is marked. Past the stage, where lists, tables and quotes run
 * under the corner, it steps aside (`html.readout-off`, one ScrollTrigger). It also steps
 * aside on scroll down and returns on scroll up (motion/index.ts, `html.readout-away`).
 *
 * Phones (under 768 px): not fixed at all. The readout renders in the flow where the page
 * places it, right under the page's header, as a plain mono line.
 */
export const ReadoutSlot = createContext<HTMLElement | null>(null);

const PHONE = "(max-width: 767px)";

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

function findStage(): HTMLElement | null {
  const main = document.getElementById("main");
  if (!main) return null;
  const marked = main.querySelector<HTMLElement>("[data-stage]");
  if (marked) return marked;
  const root = main.firstElementChild as HTMLElement | null;
  if (!root) return null;
  // The page root's first block with a size; the root itself when it is one block.
  for (const el of Array.from(root.children) as HTMLElement[]) if (el.offsetHeight > 0) return el;
  return root;
}

export function Readout({ children, label, stage }: { children: ReactNode; label?: string; stage?: RefObject<HTMLElement | null> }) {
  const slot = useContext(ReadoutSlot);
  const phone = usePhone();

  useLayoutEffect(() => {
    if (phone || !slot) return;
    const html = document.documentElement.classList;
    const el = stage?.current ?? findStage();
    if (!el) return;
    html.add("readout-off");
    const st = ScrollTrigger.create({
      trigger: el,
      start: "top bottom",
      // Gone once the stage's bottom has risen 64 px into the viewport: under that, the next
      // block's own top padding still keeps the corner clear.
      end: "bottom bottom-=64",
      invalidateOnRefresh: true,
      onToggle: (self) => html.toggle("readout-off", !self.isActive),
    });
    html.toggle("readout-off", !st.isActive);
    return () => {
      st.kill();
      html.remove("readout-off");
    };
  }, [phone, slot, stage]);

  if (phone) {
    return (
      <div className="readout-inline" aria-label={label}>
        {children}
      </div>
    );
  }
  if (!slot) return null;
  return createPortal(
    <div className="readout__body" aria-label={label}>
      {children}
    </div>,
    slot,
  );
}
