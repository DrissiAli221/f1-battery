import { useEffect, useRef, useState } from 'react';
import { url } from '../lib/api';
import type { RegimeLabel } from '../lib/types';

export type LiveRegime = RegimeLabel | 'other';

export interface LiveState {
  driver_number: number;
  ts: string;
  regime: LiveRegime;
  lap_distance_est: number;
}

export type LiveStatus = 'connecting' | 'connected' | 'no-data' | 'disabled' | 'starting' | 'error';

export interface Live {
  status: LiveStatus;
  states: Record<number, LiveState>;
  /** Replay speed measured from the feed: session seconds per wall second, or null until known. */
  speed: number | null;
}

/**
 * Subscribes to /api/live/<key> (docs/phase7-replay.md). EventSource cannot read the status
 * code, so a probe request tells "replay disabled" (404 with a JSON body) from a transient
 * connection failure. A session nobody is replaying yet answers with a "waiting" status and keeps the
 * stream open until the replay (started on demand) delivers its first state. The probe deliberately asks for JSON: an enabled server answers 406 without
 * opening a stream (a text/event-stream probe would take a stream permit and start a Kafka
 * consumer), so the one 406 in the console is the expected "enabled" signal. Bursts are batched into one render per 100 ms.
 *
 * The SSE record carries no speed setting, so the speed is measured: how far the newest sample
 * time moved over the last ten seconds of wall time.
 */
export function useLive(sessionKey: number | null): Live {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [states, setStates] = useState<Record<number, LiveState>>({});
  const [speed, setSpeed] = useState<number | null>(null);
  const pending = useRef<Record<number, LiveState>>({});

  useEffect(() => {
    if (sessionKey === null) return;
    setStatus('connecting');
    setStates({});
    setSpeed(null);
    pending.current = {};
    let es: EventSource | null = null;
    let closed = false;
    let retry = 0;
    const history: [number, number][] = [];
    const target = url(`/live/${sessionKey}`);

    const timer = window.setInterval(() => {
      const batch = pending.current;
      const keys = Object.keys(batch);
      if (!keys.length) return;
      pending.current = {};
      let newest = 0;
      for (const k of keys) newest = Math.max(newest, Date.parse(batch[Number(k)].ts) || 0);
      const now = performance.now();
      if (newest) {
        history.push([now, newest]);
        while (history.length > 2 && now - history[0][0] > 10_000) history.shift();
        const [w0, t0] = history[0];
        if (now - w0 > 1500) setSpeed((newest - t0) / (now - w0));
      }
      setStates((s) => ({ ...s, ...batch }));
      setStatus((st) => (st === 'no-data' || st === 'connecting' || st === 'starting' ? 'connected' : st));
    }, 100);

    const open = () => {
      es = new EventSource(target);
      es.addEventListener('status', (e) => {
        try {
          const s = JSON.parse((e as MessageEvent).data) as { state: string };
          // "waiting": the session has no fresh feed yet. The stream stays open on purpose: an open
          // stream is what asks the server to start the replay, and the first state ends the wait.
          if (s.state === 'waiting' || s.state === 'no-topic') setStatus('starting');
          else setStatus('no-data');
        } catch {
          /* ignore malformed status */
        }
      });
      es.addEventListener('state', (e) => {
        try {
          const s = JSON.parse((e as MessageEvent).data) as LiveState;
          pending.current[s.driver_number] = s;
        } catch {
          /* ignore malformed record */
        }
      });
      es.onerror = () => {
        es?.close();
        if (closed) return;
        fetch(target, { headers: { Accept: 'application/json' } })
          .then(async (res) => {
            res.body?.cancel().catch(() => undefined);
            if (res.status === 404) setStatus('disabled');
            else {
              setStatus('error');
              retry = window.setTimeout(() => !closed && open(), 3000);
            }
          })
          .catch(() => {
            setStatus('error');
            retry = window.setTimeout(() => !closed && open(), 3000);
          });
      };
    };
    // Probe first: a server with replay disabled answers 404, and an EventSource would only log
    // a failed stream and retry. Anything else opens the stream.
    fetch(target, { headers: { Accept: 'application/json' } })
      .then((res) => {
        res.body?.cancel().catch(() => undefined);
        if (closed) return;
        if (res.status === 404) setStatus('disabled');
        else open();
      })
      .catch(() => !closed && open());
    return () => {
      closed = true;
      es?.close();
      window.clearInterval(timer);
      window.clearTimeout(retry);
    };
  }, [sessionKey]);

  return { status, states, speed };
}
