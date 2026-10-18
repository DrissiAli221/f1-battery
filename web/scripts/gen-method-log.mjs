// Renders web/src/content/method-log.json to docs/method-log.md.
// Regenerate with:  node web/scripts/gen-method-log.mjs   (from the repo root)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src/content/method-log.json");
const out = resolve(here, "../../docs/method-log.md");
const log = JSON.parse(readFileSync(src, "utf8"));
// Paths are relative to docs/ for GitHub rendering.
const rel = (p) => "../" + p;

let md = `# ${log.title}\n\n<!-- Generated from web/src/content/method-log.json by web/scripts/gen-method-log.mjs. Edit the JSON, then re-run the script. -->\n\n${log.intro}\n`;
log.entries.forEach((e, i) => {
  md += `\n## ${i + 1}. ${e.title}\n\n*${e.phase}, ${e.date}*\n\n`;
  md += `**Tried.** ${e.tried}\n\n**Check.** ${e.check}\n\n**Found.** ${e.found}\n\n${e.figure ? `![${e.figure.alt}](${e.figure.src.replace(/^figures\//, "figures/")})\n\n*${e.figure.caption}*\n\n` : ""}**Consequence.** ${e.consequence}\n\n`;
  md += `Sources: ${e.sources.map((s) => `[${s.label}](${rel(s.path)})`).join(", ")}\n`;
});
writeFileSync(out, md);
console.log(`wrote ${out} (${log.entries.length} entries)`);
