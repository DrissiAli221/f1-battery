import { lazy, Suspense, useEffect } from "react";
import { MotionConfig } from "motion/react";
import { Shell } from "./components/Shell";
import { Empty, Loading } from "./components/ui";
import { LandingPage } from "./pages/LandingPage";
import { href, useLocation, type Route } from "./lib/router";

// The landing page ships in the main bundle; the rest load on first visit.
const SessionsPage = lazy(() => import("./pages/SessionsPage").then((m) => ({ default: m.SessionsPage })));
const SessionPage = lazy(() => import("./pages/SessionPage").then((m) => ({ default: m.SessionPage })));
const FindingsPage = lazy(() => import("./pages/FindingsPage").then((m) => ({ default: m.FindingsPage })));
const MethodLogPage = lazy(() => import("./pages/MethodLogPage").then((m) => ({ default: m.MethodLogPage })));
const LivePage = lazy(() => import("./pages/LivePage").then((m) => ({ default: m.LivePage })));

const TITLES: Record<Route["name"], string> = {
  landing: "Energy/26",
  sessions: "Sessions · Energy/26",
  session: "Explorer · Energy/26",
  findings: "Findings · Energy/26",
  method: "Method log · Energy/26",
  live: "Live · Energy/26",
  missing: "Not found · Energy/26",
};

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case "landing":
      return <LandingPage />;
    case "sessions":
      return <SessionsPage />;
    case "session":
      return <SessionPage key={route.key} sessionKey={route.key} />;
    case "findings":
      return <FindingsPage />;
    case "method":
      return <MethodLogPage />;
    case "live":
      return <LivePage key={route.key ?? "index"} sessionKey={route.key} />;
    case "missing":
      return (
        <div className="wrap section">
          <Empty title="Page not found">
            Nothing lives at {route.path}. <a className="prose-link" href={href.landing}>Go to the start</a>.
          </Empty>
        </div>
      );
  }
}

export function App() {
  const { route, path } = useLocation();
  // New page: start at the top. Query-only changes (explorer state) keep the scroll position.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = TITLES[route.name];
  }, [path, route.name]);
  return (
    <MotionConfig reducedMotion="user">
      <Shell route={route}>
        <Suspense fallback={<Loading className="h-[60vh]" />}>
          <Page route={route} />
        </Suspense>
      </Shell>
    </MotionConfig>
  );
}
