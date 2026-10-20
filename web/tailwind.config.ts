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
        ground: { DEFAULT: v("--page-bg"), 2: v("--ground-2") },
        muted: v("--muted"),
        accent: v("--accent"),
        surface: v("--surface"),
        deep: v("--surface-deep"),
        frame: v("--frame"),
        // --line is already translucent, so it is used as is (no opacity modifier).
        line: { DEFAULT: "var(--line)", 2: "var(--line-2)", strong: "var(--line-strong)" },
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
      fontSize: {
        display: ["var(--t-display)", { lineHeight: "var(--lh-display)", letterSpacing: "var(--tr-display)" }],
        section: ["var(--t-section)", { lineHeight: "1", letterSpacing: "var(--tr-section)" }],
        body: ["var(--t-body)", { lineHeight: "1.5" }],
        ui: ["var(--t-ui)", { lineHeight: "1.35", letterSpacing: "0" }],
        "ui-s": ["var(--t-ui-s)", { lineHeight: "1.35", letterSpacing: "0" }],
        mono: ["var(--t-mono)", { lineHeight: "1.35" }],
      },
      maxWidth: { container: "var(--container)", measure: "var(--measure)" },
      borderRadius: {
        none: "0",
        pill: "var(--radius-pill)",
        xxs: "var(--radius-xxs)",
        xs: "var(--radius-xs)",
        s: "var(--radius-s)",
        m: "var(--radius-m)",
        l: "var(--radius-l)",
        xl: "var(--radius-xl)",
      },
      spacing: {
        header: "var(--header-h)",
        gutter: "var(--gutter)",
        tight: "var(--rhythm-tight)",
        normal: "var(--rhythm-normal)",
        airy: "var(--rhythm-airy)",
        section: "var(--section-y)",
        "head-top": "var(--head-top)",
        "grid-top": "var(--grid-top)",
        "head-gap": "var(--head-gap)",
        stack: "var(--stack)",
      },
    },
  },
  plugins: [],
} satisfies Config;
