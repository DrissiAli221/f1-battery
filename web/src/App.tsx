import { useEffect, useState } from "react";
import { SessionsPage } from "./SessionsPage";
import { SessionView } from "./SessionView";
import { MethodLog } from "./MethodLog";
import { LivePage } from "./LivePage";
import { apiBase } from "./api";

/** Minimal hash router: "#/" lists sessions, "#/session/<key>" opens one, "#/live/<key>" follows a replay, "#/method" is the method log. */
function useRoute(): string {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const hash = useRoute();
  const m = /^#\/session\/(\d+)/.exec(hash);
  const live = /^#\/live\/(\d+)/.exec(hash);
  return (
    <div className="shell">
      <header className="top">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true" />
          Deployment view
        </a>
        <a className="navlink" href="#/method" aria-current={hash.startsWith("#/method") ? "page" : undefined}>Method log</a>
        <span className="tag">Estimates from public telemetry, not measured battery data</span>
      </header>
      <main>
        {m ? <SessionView sessionKey={Number(m[1])} /> : live ? <LivePage sessionKey={Number(live[1])} /> : hash.startsWith("#/method") ? <MethodLog /> : <SessionsPage />}
      </main>
      <footer className="foot">
        Data from OpenF1 (CC BY-NC-SA), non-commercial. Not affiliated with F1, FIA or FOM. API: {apiBase}
      </footer>
    </div>
  );
}
