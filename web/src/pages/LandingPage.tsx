import { useMemo, useRef } from "react";
import notes from "../content/findings-notes.json";
import { Cta, CtaGhost } from "../components/Cta";
import { HeroStage } from "../components/HeroStage";
import { Pill } from "../components/system";
import { useList } from "../lib/api";
import { href } from "../lib/router";
import type { SessionRow } from "../lib/types";
import { scrollToTarget, usePage } from "../motion";
import { HERO_SESSION, useHero } from "../landing/data";
import { HowItIsRead } from "../landing/HowItIsRead";
import { LastRace } from "../landing/LastRace";
import { RecordStrip } from "../landing/RecordStrip";
import { Season } from "../landing/Season";
import { Verdict, frozenText } from "../landing/Verdict";
import "../landing/landing.css";

/*
 * The landing (DESIGN.md v3 "Pages → Landing"): the hero photo with the question and the
 * verdict as a pill; the last race on the track map; the verdict as stat tiles; how a speed
 * trace is read; the season as session cards; the record strip on a card. Footer: the shell's.
 */
export function LandingPage() {
  const sessions = useList<SessionRow>("/sessions");
  const monza = sessions.data?.find((s) => s.session_key === HERO_SESSION) ?? null;
  const hero = useHero(monza);
  const progress = useRef({ current: 0 }).current;
  const page = usePage<HTMLDivElement>(undefined, [sessions.data, hero.profile]);
  // The latest race or sprint with published estimates.
  const last = useMemo(
    () =>
      [...(sessions.data ?? [])]
        .filter((s) => s.has_results && (s.session_name === "Race" || s.session_name === "Sprint"))
        .sort((a, b) => (b.date_start ?? "").localeCompare(a.date_start ?? ""))[0] ?? null,
    [sessions.data],
  );

  // The CTA keeps a real link (the findings page) and, with JS, scrolls to the verdict instead:
  // the hash is the router, so a same-page anchor cannot be an href.
  const toVerdict = (e: React.MouseEvent) => {
    e.preventDefault();
    scrollToTarget("#verdict", -64);
    document.getElementById("verdict-h")?.focus({ preventScroll: true });
  };

  return (
    <div ref={page} className="lp">
      <HeroStage
        progress={progress}
        label="The question"
        photo={{ src: "/hero.jpg", webp: "/hero.webp", webpSmall: "/hero-1280.webp", alt: "Formula 1 mark on a dark grain with a red glow" }}
      >
        <p className="lp-hero__pill" data-intro>
          <Pill>
            No effect · frozen <span className="num">{frozenText()}</span>
          </Pill>
        </p>
        <h1 className="hero-q lp-hero__q" data-intro>
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

      <LastRace session={last} loading={sessions.loading} />
      <Verdict />
      <HowItIsRead profile={hero.profile} labels={hero.labels} pending={hero.status === "pending"} />
      <Season sessions={sessions.data ?? []} loading={sessions.loading} />
      <RecordStrip card />
    </div>
  );
}
