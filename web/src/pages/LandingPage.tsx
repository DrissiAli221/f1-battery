import { useRef } from "react";
import notes from "../content/findings-notes.json";
import { Cta, CtaGhost } from "../components/Cta";
import { HeroStage } from "../components/HeroStage";
import { Readout } from "../components/Readout";
import { useList } from "../lib/api";
import { href } from "../lib/router";
import type { SessionRow } from "../lib/types";
import { scrollToTarget, usePage } from "../motion";
import { HERO_SESSION, useHero } from "../landing/data";
import { HowItIsRead } from "../landing/HowItIsRead";
import { RecordStrip } from "../landing/RecordStrip";
import { Season } from "../landing/Season";
import { Verdict, frozenText } from "../landing/Verdict";
import "../landing/landing.css";

/*
 * The landing (DESIGN.md "Composition plan, Landing"): hero (poster over the straight), the
 * verdict (statement plus one fact), how it is read (sticky narrative), the season (index
 * list), the record (data strip, full viewport); the footer finale lives in the shell.
 * Each section takes a different rhythm mood: full viewport, normal, airy, tight, full.
 */
export function LandingPage() {
  const sessions = useList<SessionRow>("/sessions");
  const monza = sessions.data?.find((s) => s.session_key === HERO_SESSION) ?? null;
  const hero = useHero(monza);
  const progress = useRef({ current: 0 }).current;
  const page = usePage<HTMLDivElement>(undefined, [sessions.data, hero.profile]);

  // The CTA keeps a real link (the findings page) and, with JS, scrolls to the verdict instead:
  // the hash is the router, so a same-page anchor cannot be an href (DESIGN.md build rules).
  const toVerdict = (e: React.MouseEvent) => {
    e.preventDefault();
    scrollToTarget("#verdict", -64);
    document.getElementById("verdict-h")?.focus({ preventScroll: true });
  };

  return (
    <div ref={page}>
      <HeroStage
        progress={progress}
        label="The question"
        photo={{ src: "/hero.jpg", webp: "/hero.webp", webpSmall: "/hero-1280.webp", alt: "Formula 1 mark on a dark grain with a red glow" }}
      >
        <h1 className="hero-q" data-intro>
          {notes.question}
        </h1>
        <p className="hero-p" data-intro>
          F1 does not publish battery data. Everything here is read off public speed traces, under stated assumptions.
        </p>
        <div className="hero-ctas" data-intro>
          <span className="contents" onClickCapture={toVerdict}>
            <Cta href={href.findings}>Read the finding</Cta>
          </span>
          <CtaGhost href={href.session(HERO_SESSION, { driver: 1, compare: 63, straight: 2 })}>Open the explorer</CtaGhost>
        </div>
      </HeroStage>

      <div className="wrap">
        <Readout>
          <p>
            No effect · frozen <span className="whitespace-nowrap">{frozenText()}</span>
          </p>
        </Readout>
      </div>
      <Verdict />
      <HowItIsRead profile={hero.profile} labels={hero.labels} pending={hero.status === "pending"} />
      <Season sessions={sessions.data ?? []} loading={sessions.loading} />
      <RecordStrip />
    </div>
  );
}
