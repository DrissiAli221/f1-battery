export type SessionKind = 'Race' | 'Qualifying' | 'Sprint' | 'Sprint Qualifying';

// 24x24 grid, stroke 1.5, no fill. The same paths are mirrored as CSS masks in refinement.css.
export const SESSION_ICON_PATHS: Record<SessionKind, string> = {
  Race: 'M5 21V3M5 4h14v8H5M9.67 4v8M14.33 4v8M5 8h14',
  Qualifying: 'M10 3h4M12 3v3M12 13V9M12 6a7 7 0 1 0 0 14a7 7 0 0 0 0-14Z',
  Sprint: 'M13 2 5 13.5h6L10 22l9-12h-6Z',
  'Sprint Qualifying':
    'M10 3h4M12 3v3M12 6a7 7 0 1 0 0 14a7 7 0 0 0 0-14ZM12.6 9 9.4 13.2h2.3l-.6 3.8 3.5-4.4h-2.4Z',
};

export function SessionIcon({ kind, size = 14 }: { kind: string; size?: number }) {
  const d = SESSION_ICON_PATHS[kind as SessionKind];
  if (!d) return null;
  return (
    <svg
      className="session-icon"
      data-kind={kind}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
