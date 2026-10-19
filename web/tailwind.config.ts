import type { Config } from "tailwindcss";

// Every value points at a custom property in src/styles/tokens.css, so tokens stay in one file.
// Colours go through color-mix so opacity modifiers (bg-surface/90) still work on variables.
const v = (name: string) => ({ opacityValue }: { opacityValue?: string }) =>
  opacityValue === undefined ? `var(${name})` : `color-mix(in srgb, var(${name}) calc(${opacityValue} * 100%), transparent)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: v("--page-bg"),
        surface: v("--surface"),
        deep: v("--surface-deep"),
        frame: v("--frame"),
        line: { DEFAULT: v("--line"), 2: v("--line-2") },
        ink: {
          DEFAULT: v("--ink"),
          head: v("--ink-head"),
          2: v("--ink-2"),
          3: v("--ink-3"),
          4: v("--ink-4"),
        },
        brand: { DEFAULT: v("--brand"), hover: v("--brand-hover"), pressed: v("--brand-pressed"), deep: v("--brand-deep") },
        badge: v("--color-surface-badge"),
        ok: v("--color-surface-success"),
        warn: v("--color-surface-warning"),
        regime: {
          deploy: v("--regime-deploy"),
          plateau: v("--regime-plateau"),
          lift: v("--regime-lift"),
          brake: v("--regime-brake"),
          other: v("--regime-other"),
        },
      },
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
        display: "var(--font-display)",
      },
      borderRadius: {
        xxs: "var(--radius-xxs)",
        xs: "var(--radius-xs)",
        s: "var(--radius-s)",
        m: "var(--radius-m)",
        l: "var(--radius-l)",
        xl: "var(--radius-xl)",
      },
      maxWidth: { container: "var(--container)" },
      spacing: { header: "var(--header-h)" },
    },
  },
  plugins: [],
} satisfies Config;
