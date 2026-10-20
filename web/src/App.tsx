import { lazy, Suspense } from "react";
import { MotionConfig } from "motion/react";
import { Shell } from "./components/Shell";
import { Loading } from "./components/ui";
import { LandingPage } from "./pages/LandingPage";
import { useRouteMeta } from "./lib/meta";
import { useLocation, type Route } from "./lib/router";

// The landing page ships in the main bundle; the rest load on first visit.
const SessionsPage = lazy(() => import("./pages/SessionsPage").then((m) => ({ default: m.SessionsPage })));
const SessionPage = lazy(() => import("./pages/SessionPage").then((m) => ({ default: m.SessionPage })));
const FindingsPage = lazy(() => import("./pages/FindingsPage").then((m) => ({ default: m.FindingsPage })));
const MethodLogPage = lazy(() => import("./pages/MethodLogPage").then((m) => ({ default: m.MethodLogPage })));
// Temporary instrument preview on a fixture; the route only exists on the dev server.
// The DEV guard lets the production build drop the chunk (and its fixture) entirely.
const DevStraightPage = import.meta.env.DEV
  ? lazy(() => import("./pages/DevStraightPage").then((m) => ({ default: m.DevStraightPage })))
  : () => null;
const DevMapPage = import.meta.env.DEV ? lazy(() => import("./pages/DevMapPage").then((m) => ({ default: m.DevMapPage }))) : () => null;
const LivePage = lazy(() => import("./pages/LivePage").then((m) => ({ default: m.LivePage })));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })));

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
    case "dev-map":
      return <DevMapPage />;
    case "dev-straight":
      return <DevStraightPage />;
    case "missing":
      return <NotFoundPage path={route.path} />;
  }
}

export function App() {
  const { route, path } = useLocation();
  // Scroll reset, focus and the curtain live in the shell (motion/useRouteChange); query-only
  // changes (explorer state) are not route changes and keep the scroll position.
  useRouteMeta(route.name);
  return (
    <MotionConfig reducedMotion="user">
      <Shell route={route} path={path}>
        {/* A full-viewport fallback keeps the footer below the fold while a lazy page loads (no layout shift). */}
        <Suspense fallback={<Loading className="h-[100svh]" />}>
          <Page route={route} />
        </Suspense>
      </Shell>
    </MotionConfig>
  );
}
