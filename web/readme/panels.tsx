/* Dev-only README panel renderer. Builds nothing for production: it is served through vite.readme.config.ts. */
import { StrictMode, useEffect, useRef, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { Atmosphere, PageGround } from '../src/app/chrome';
import { CircuitMini } from '../src/app/circuit-mini';
import { paintScreen } from '../src/app/session-halftone';
import { circuitPhoto } from '../src/track/circuits';
import { teamCar, teamLogo } from '../src/lib/teams';
import '../src/app/session.css';
import '../src/app/findings.css';
import '../src/app/refinement.css';
import '../src/app/home.css';
import './panels.css';

const MONZA = 39;

function Banner() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    paintScreen(el);
    document.documentElement.dataset.painted = '1';
  }, []);
  return (
    <div className="panel panel-banner session-preview" id="banner">
      <PageGround>
        <section className="hero-band">
          <div className="race-hero wrap">
            <div className="race-halftone" aria-hidden="true">
              <canvas ref={canvas} data-screen="hero" />
            </div>
            <CircuitMini circuit={MONZA} className="banner-circuit" weight={5} label="Monza circuit outline" />
            <div>
              <p className="banner-eyebrow">
                <span>2026 season</span>
                <span>Public telemetry</span>
                <span>Pre-registered test</span>
              </p>
              <h1>F1 Battery.</h1>
              <p className="banner-lede">Where does electrical deployment end on a straight, and does it predict an overtake?</p>
              <div className="method-section banner-notice"><aside className="notice notice-caution">
                <svg className="notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8Z" />
                  <path d="M12 7v6m0 3v1" />
                </svg>
                <div className="notice-content">
                  <h2>Estimates, not measurements.</h2>
                  <p>Battery state and power aren’t public. Values are inferred from telemetry.</p>
                </div>
              </aside></div>
            </div>
          </div>
        </section>
      </PageGround>
    </div>
  );
}

type N = { k: string; t: string; s: string; i: string; pub?: boolean; w?: number };
/* 24-grid line icons, 1.6 stroke, round joins, no fills (same style as session-icons.tsx). */
const ICONS: Record<string, string> = {
  cloud: 'M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 8.5a4.75 4.75 0 0 1 0 9.5M12 11v8m-3-3 3 3 3-3',
  ingest: 'M4 6c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2ZM4 6v6c0 1.1 3.6 2 8 2M20 6v4M3 19h8m-3-3 3 3-3 3',
  db: 'M4 6c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2ZM4 6v12c0 1.1 3.6 2 8 2s8-.9 8-2V6M4 12c0 1.1 3.6 2 8 2s8-.9 8-2',
  chart: 'M3 20h18M4 16l5-5 4 3 6-8M19 6m-1.5 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0',
  tag: 'M3 12V4h8l10 10-8 8L3 12ZM7.5 8.5h.01',
  code: 'm8 7-5 5 5 5M16 7l5 5-5 5M14 5l-4 14',
  browser: 'M3 5h18v14H3ZM3 9h18M6 7h.01M9 7h.01',
  play: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM10 8.5v7l6-3.5Z',
  log: 'M4 6h16M4 12h16M4 18h16',
  headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H5a1 1 0 0 1-1-1ZM20 15h-3v5h2a1 1 0 0 0 1-1Z',
  layers: 'm12 3 9 5-9 5-9-5ZM3 13l9 5 9-5M3 17.5l9 5 9-5',
  radio: 'M12 11.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3ZM8.5 8a5 5 0 0 0 0 8M15.5 8a5 5 0 0 1 0 8M5.5 5a9 9 0 0 0 0 14M18.5 5a9 9 0 0 1 0 14',
};
const Icon = ({ n }: { n: string }) => (
  <svg className="pl-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={ICONS[n]} />
  </svg>
);
const MAIN: N[] = [
  { k: 'Source', t: 'OpenF1', s: 'Free tier, or a local backup', i: 'cloud' },
  { k: 'Java 21', t: 'Ingest', s: 'Idempotent, resumable upserts', i: 'ingest' },
  { k: 'Store', t: 'Postgres 16 + TimescaleDB', s: 'Schema in Flyway migrations', i: 'db', w: 1.45 },
  { k: 'Python', t: 'Estimator', s: 'Alignment, regimes, cut-offs', i: 'chart' },
  { k: 'Published', t: 'Model run', s: 'Versioned by run_id', i: 'tag', pub: true },
  { k: 'Read-only', t: 'API', s: 'API on :8080. SELECT-only role, rate limited', i: 'code' },
  { k: 'React 18', t: 'Web', s: 'Maps, findings, method log', i: 'browser' },
];
const LANE: N[] = [
  { k: 'Producer', t: 'Replay producer', s: 'Telemetry paced at speed', i: 'play' },
  { k: 'Topic', t: 'telemetry.<key>', s: 'One session per key', i: 'log' },
  { k: 'Consumer', t: 'Replay consumer', s: 'Labels regimes per driver', i: 'headphones' },
  { k: 'Topic', t: 'regime-state.<key>', s: 'Per-driver regime state', i: 'layers' },
  { k: 'Stream', t: 'SSE /api/live/{key}', s: 'To the browser', i: 'radio' },
];

function Flow({ nodes, cls }: { nodes: N[]; cls?: string }) {
  return (
    <>
      {nodes.map((n, i) => (
        <span key={n.t} style={{ display: 'contents' }}>
          {i > 0 && <span className={`pl-arrow ${cls ?? ''}`} aria-hidden="true">→</span>}
          <div className={`pl-node ${cls ?? ''}${n.pub ? ' is-published' : ''}`} style={n.w ? { flexGrow: n.w } : undefined}>
            <Icon n={n.i} />
            <span className="k">{n.k}</span>
            <strong>{n.t}</strong>
            <small>{n.s}</small>
          </div>
        </span>
      ))}
    </>
  );
}

const STAGES = [
  { id: 'data', label: 'Data', nodes: MAIN.slice(0, 3) },
  { id: 'model', label: 'Model', nodes: MAIN.slice(3, 5) },
  { id: 'serve', label: 'Serve', nodes: MAIN.slice(5) },
];

function Pipeline() {
  return (
    <div className="panel panel-pipeline" id="pipeline">
      <p className="pl-eyebrow"><span>How it works</span><b>Estimates, not measurements</b></p>
      <div className="pl-flow">
        {STAGES.map((s, i) => (
          <span key={s.id} style={{ display: 'contents' }}>
            {i > 0 && <span className={`pl-arrow pl-gap st-${STAGES[i - 1].id}`} aria-hidden="true">→</span>}
            <div className={`pl-stage st-${s.id}`} style={{ flexGrow: s.nodes.reduce((a, n) => a + (n.w ?? 1), 0) }}>
              <div className="pl-flow"><Flow nodes={s.nodes} cls={`st-${s.id}`} /></div>
            </div>
          </span>
        ))}
      </div>
      <p className="pl-meet">Python and Java meet only at one versioned results table</p>
      <div className="pl-lane">
        <p className="pl-eyebrow"><span>Live replay lane · optional</span><span>API_REPLAY_ENABLED</span></p>
        <div className="pl-flow"><Flow nodes={LANE} /></div>
        <p className="pl-note">Kafka is isolated to replay, behind a Compose profile and an API flag.</p>
      </div>
    </div>
  );
}


const heightParam = Number(new URLSearchParams(location.search).get('h')) || 520;
const Notice = () => (
  <div className="method-section banner-notice"><aside className="notice notice-caution">
    <svg className="notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8Z" />
      <path d="M12 7v6m0 3v1" />
    </svg>
    <div className="notice-content">
      <h2>Estimates, not measurements.</h2>
      <p>Battery state and power aren’t public. Values are inferred from telemetry.</p>
    </div>
  </aside></div>
);
const Eyebrow = () => (
  <p className="banner-eyebrow">
    <span>2026 season</span>
    <span>Public telemetry</span>
    <span>Pre-registered test</span>
  </p>
);
function usePaint() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    paintScreen(el);
    document.documentElement.dataset.painted = '1';
  }, []);
  return canvas;
}

/* A: the home hero, with a venue photograph full-bleed behind it. */
function BannerHome() {
  const canvas = usePaint();
  const photo = circuitPhoto(39, 2400)!;
  return (
    <div className="panel panel-v panel-home session-preview home-preview" id="banner" style={{ height: heightParam }}>
      <PageGround className="home-ground">
        <section className="hero-band">
          <div className="home-hero wrap">
            <div className="race-photo hero-photo" aria-hidden="true"><img src={photo} alt="" /></div>
            <div className="home-screen" aria-hidden="true"><canvas ref={canvas} data-screen="hero" /></div>
            <div className="home-intro">
              <Eyebrow />
              <h1 id="home-title">F1 Battery.</h1>
              <div className="home-intro-bottom">
                <p>F1 keeps its battery data out of sight. Explore where electrical deployment may end, one straight at a time.</p>
              </div>
            </div>
          </div>
        </section>
      </PageGround>
    </div>
  );
}

/* B: the session hero band, venue photo dissolving in from the right, bloom canvas, circuit outline, caution notice. */
function BannerSession() {
  const canvas = usePaint();
  const photo = circuitPhoto(39, 2400)!;
  return (
    <div className="panel panel-v panel-session session-preview" id="banner" style={{ height: heightParam }}>
      <PageGround>
        <section className="hero-band">
          <div className="race-hero wrap">
            <div className="race-photo hero-photo" aria-hidden="true"><img src={photo} alt="" /></div>
            <div className="race-halftone" aria-hidden="true"><canvas ref={canvas} data-screen="hero" /></div>
            <CircuitMini circuit={MONZA} className="banner-circuit" weight={5} label="Monza circuit outline" />
            <div>
              <Eyebrow />
              <h1>F1 Battery.</h1>
              <Notice />
            </div>
          </div>
        </section>
      </PageGround>
    </div>
  );
}

type P = { n: number; first: string; last: string; team: string; colour: string };
const POSTERS: P[] = [
  { n: 1, first: 'Lando', last: 'Norris', team: 'McLaren', colour: '#F47600' },
  { n: 3, first: 'Max', last: 'Verstappen', team: 'Red Bull Racing', colour: '#4781D7' },
  { n: 16, first: 'Charles', last: 'Leclerc', team: 'Ferrari', colour: '#ED1131' },
  { n: 63, first: 'George', last: 'Russell', team: 'Mercedes', colour: '#00D7B6' },
];
function Poster({ d }: { d: P }) {
  const rgb = d.colour.replace('#', '').match(/.{2}/g)!.map((v) => parseInt(v, 16));
  const lin = rgb.map((c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  const ink = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722 > 0.179 ? '#101010' : '#fff';
  const logo = teamLogo(d.team, ink === '#101010' ? 'black' : 'white');
  return (
    <article className="driver-estimate driver-poster" style={{ '--team': d.colour, '--poster-ink': ink } as CSSProperties}>
      <div className="driver-poster-art">
        <span className="poster-screen" aria-hidden="true" />
        <span className="poster-number" aria-hidden="true">{d.n}</span>
        <div className="poster-team">{logo && <img className="team-logo" src={logo} alt="" />}<span>{d.team}</span></div>
        <div className="poster-name">
          <span>{d.first}</span>
          <h3 style={{ '--surname-length': Math.max(1, d.last.length) } as CSSProperties}>{d.last}</h3>
        </div>
        <img className="poster-car" src={teamCar(d.team, 262)!} alt="" />
      </div>
    </article>
  );
}
/* C: a strip of four real driver poster headers under a slim title row. */
function BannerPosters() {
  useEffect(() => { document.documentElement.dataset.painted = '1'; }, []);
  return (
    <div className="panel panel-v panel-posters session-preview" id="banner" style={{ height: heightParam }}>
      <PageGround>
        <section className="hero-band">
          <div className="wrap poster-title-row">
            <h1>F1 Battery.</h1>
            <Notice />
          </div>
          <div className="wrap poster-strip">{POSTERS.map((d) => <Poster key={d.n} d={d} />)}</div>
        </section>
      </PageGround>
    </div>
  );
}

/* Deployment panel (?p=deployment): static content, no API. */
const GH = '#8a8a84', AWS = '#27f4d2', VM = '#ff4d44', JOB = '#f0b429', DATA = '#6a9fff';
Object.assign(ICONS, {
  github: 'M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21',
  server: 'M3 4h18v6H3ZM3 14h18v6H3ZM7 7h.01M7 17h.01',
  bucket: 'M4 7c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2ZM4 7l2 12c0 1 2.7 2 6 2s6-1 6-2l2-12',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.5 2.7 3.5 5.7 3.5 9s-1 6.3-3.5 9c-2.5-2.7-3.5-5.7-3.5-9s1-6.3 3.5-9Z',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6Z',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 20c0-3.5 3.6-6 8-6s8 2.5 8 6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2',
  key: 'M14 10a4 4 0 1 0-3.5 4L12 15.5V18h2.5v2.5H17V18l2-2-5-6Z',
  box: 'm12 3 8 4.5v9L12 21l-8-4.5v-9ZM4 7.5l8 4.5 8-4.5M12 12v9',
});
type D = { k: string; t: string; s: string; i: string; h: string };
type Group = { h: string; label: string; title: string; icon: string; items: string[] };
const GROUPS: Group[] = [
  { h: GH, label: 'Source', title: 'GitHub', icon: 'github', items: ['Repo DrissiAli221/f1-battery', 'Branch deploy', 'Read-only deploy key on the VM', 'CI is verify-only'] },
  { h: AWS, label: 'AWS · Terraform in infra/aws-f1', title: 'CloudFront + S3', icon: 'globe', items: ['CloudFront: default origin S3; /api/* to the VM over HTTP with an X-Origin-Secret header; /api/live/* unbuffered SSE', 'S3 web bucket: web/dist, synced on each build', 'S3 data bucket: private-assets/ fonts, db-backups/ nightly dumps (14-day expiry), raw/ OpenF1 backup', 'IAM user f1-battery-vm, least privilege'] },
  { h: VM, label: 'Oracle VM oracle-arm-1 · Always Free', title: 'Compose project f1-battery', icon: 'server', items: ['Ubuntu 24.04 ARM, 2 OCPU / 12 GB, in /opt/f1-battery', 'Shared with another project (RCP): its Caddy owns 80/443 and imports the f1 site block (403 without the secret, 405 on writes, proxies /api to f1-api:8080)', 'Always up: db, api, kafka, replay-consumer', 'Jobs: ingest, model, replay-producer, s3'] },
];
const DEPLOY: D[] = [
  { k: 'GitHub', t: 'Branch deploy', s: 'git pull over the read-only deploy key', i: 'github', h: GH },
  { k: 'VM · deploy.sh', t: 'Build web', s: 'Vite build on the VM', i: 'code', h: VM },
  { k: 'AWS S3', t: 'Web bucket', s: 'web/dist synced on each build', i: 'bucket', h: AWS },
  { k: 'AWS', t: 'CloudFront', s: 'd1913ktwn45t9g.cloudfront.net', i: 'globe', h: AWS },
  { k: 'Public', t: 'Visitor', s: 'Static site from S3', i: 'user', h: GH },
];
const REQUEST: D[] = [
  { k: 'Public', t: 'Visitor', s: 'Browser, any region', i: 'user', h: GH },
  { k: 'AWS', t: 'CloudFront /api/*', s: 'HTTP to the VM with X-Origin-Secret', i: 'globe', h: AWS },
  { k: 'VM · shared', t: 'Caddy (RCP)', s: '403 without the secret, 405 on writes', i: 'shield', h: VM },
  { k: 'Container', t: 'api', s: 'Spring Boot, read-only role', i: 'code', h: VM },
  { k: 'Container', t: 'db', s: 'Postgres 16 + TimescaleDB', i: 'db', h: VM },
];
const REPLAY: D[] = [
  { k: 'Service · always on', t: 'replay-producer', s: 'Looping systemd service', i: 'play', h: JOB },
  { k: 'Container', t: 'Kafka topic', s: 'kafka 3.8, KRaft', i: 'log', h: VM },
  { k: 'Container', t: 'replay-consumer', s: 'Labels regimes per driver', i: 'headphones', h: VM },
  { k: 'Container', t: 'api SSE', s: '/api/live/{key}', i: 'radio', h: VM },
  { k: 'AWS', t: 'CloudFront /api/live/*', s: 'Unbuffered, to the visitor', i: 'globe', h: AWS },
];
const TIMERS: D[] = [
  { k: 'f1-backup.timer', t: 'Nightly 02:00 UTC', s: 'pg_dump to S3 db-backups/, 14-day expiry', i: 'clock', h: JOB },
  { k: 'f1-weekly.timer', t: 'Monday 04:00 UTC', s: 'OpenF1 backup, ingest, model, publish, S3 sync', i: 'clock', h: JOB },
  { k: 'AWS S3', t: 'Data bucket', s: 'private-assets/, db-backups/, raw/', i: 'bucket', h: AWS },
];
function DFlow({ nodes, dashed, noLink }: { nodes: D[]; dashed?: boolean; noLink?: (i: number) => boolean }) {
  return (
    <div className="pl-flow">
      {nodes.map((n, i) => (
        <span key={n.t + i} style={{ display: 'contents' }}>
          {i > 0 && <span className="pl-arrow" style={{ ['--h' as string]: nodes[i - 1].h }} aria-hidden="true">{noLink?.(i) ? '' : '→'}</span>}
          <div className="pl-node dp-node" style={{ ['--h' as string]: n.h, ...(dashed ? { borderStyle: 'dashed', borderColor: `color-mix(in srgb, ${n.h} 35%, transparent)` } : {}) } as CSSProperties}>
            <Icon n={n.i} />
            <span className="k">{n.k}</span>
            <strong>{n.t}</strong>
            <small>{n.s}</small>
          </div>
        </span>
      ))}
    </div>
  );
}
function Deployment() {
  useEffect(() => { document.documentElement.dataset.painted = '1'; }, []);
  return (
    <div className="panel panel-pipeline panel-deploy" id="deployment">
      <p className="pl-eyebrow"><span>How it is deployed</span><b>d1913ktwn45t9g.cloudfront.net</b></p>
      <div className="dp-groups">
        {GROUPS.map((g) => (
          <div key={g.title} className="pl-node dp-group" style={{ ['--h' as string]: g.h } as CSSProperties}>
            <Icon n={g.icon} />
            <span className="k">{g.label}</span>
            <strong>{g.title}</strong>
            <ul>{g.items.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        ))}
      </div>
      <div className="dp-lane"><p className="pl-eyebrow"><span>Deploy and publish</span><span>deploy.sh</span></p><DFlow nodes={DEPLOY} /></div>
      <div className="dp-lane"><p className="pl-eyebrow"><span>Request path</span><span>/api/*</span></p><DFlow nodes={REQUEST} /></div>
      <div className="dp-lane pl-lane"><p className="pl-eyebrow"><span style={{ color: JOB }}>Live replay lane</span><span>/api/live/*</span></p><DFlow nodes={REPLAY} dashed /></div>
      <div className="dp-lane"><p className="pl-eyebrow"><span style={{ color: JOB }}>systemd timers</span><span>UTC</span></p><DFlow nodes={TIMERS} noLink={(i) => i === 1} /></div>
    </div>
  );
}

const which = new URLSearchParams(location.search).get('p');
createRoot(document.getElementById('panels-root')!).render(
  <StrictMode>{which === 'pipeline' ? <Pipeline /> : which === 'deployment' ? <Deployment /> : which === 'a' ? <BannerHome /> : which === 'b' ? <BannerSession /> : which === 'c' ? <BannerPosters /> : <Banner />}</StrictMode>
);
void Atmosphere;
