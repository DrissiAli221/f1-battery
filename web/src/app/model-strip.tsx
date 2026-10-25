import { useList, useRemote, url } from '../lib/api';
import type { SessionRow } from '../lib/types';

interface ModelRow {
  model_version: string;
  run_id: string;
  created_at: string;
}
interface ModelPage {
  items: ModelRow[];
  total: number;
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * One line that says which model the explorer runs on right now, read live from the API, so the
 * frozen record below it is never mistaken for the current model. The slot is reserved while it
 * loads and stays reserved on failure.
 */
export function ModelStrip({ frozen }: { frozen: string }) {
  const models = useRemote<ModelPage>(url('/models'));
  const sessions = useList<SessionRow>('/sessions');
  const latest = models.data?.items?.[0] ?? null;
  const withResults = sessions.data ? sessions.data.filter((s) => s.has_results).length : null;
  const ready = latest !== null && withResults !== null;
  return (
    <p className={`model-strip utility${ready ? '' : ' is-loading'}`} aria-live="polite">
      <span className="model-strip-live">
        {ready ? (
          <>
            Explorer runs <b>{latest.model_version}</b> · {withResults} sessions ·{' '}
            {DATE.format(new Date(latest.created_at))}
          </>
        ) : models.error ? (
          'Current model unavailable.'
        ) : (
          'Reading the current model…'
        )}
      </span>
      <span className="model-strip-frozen">The test below is the frozen {frozen} record.</span>
    </p>
  );
}
