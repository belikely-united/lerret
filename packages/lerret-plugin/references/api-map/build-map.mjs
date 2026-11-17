// Builds the page map (_index.mmd) for an API map folder, then checks it.
//
//   node build-map.mjs "<path to the Screens and APIs folder>"
//
// Reads every area-*.data.json. Each one lists the API cards it owns:
//   "apis": ["projects", "projects-pid"]      one card id per line of the diagram
//   "links": [["mcp", "mcp-tools"]]           optional: a card that hangs off another card
// Areas are ordered by the number at the start of their title ("3 · Projects").
//
// Checks: every API card is owned by exactly one area, every owned card exists,
// and the owning area's text mentions that card's path. Exits 1 if anything fails.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) { console.error('usage: node build-map.mjs "<folder>"'); process.exit(1); }

const files = readdirSync(dir);
const areas = files
  .filter((f) => /^area-.+\.data\.json$/.test(f))
  .map((f) => ({ id: f.replace(/\.data\.json$/, ""), raw: readFileSync(join(dir, f), "utf8") }))
  .map((a) => ({ ...a, data: JSON.parse(a.raw) }))
  .sort((a, b) => parseFloat(a.data.title) - parseFloat(b.data.title));

const cards = files.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
const linked = areas.flatMap((a) => (a.data.links || []).map(([, child]) => child));
const apiCards = cards.filter((c) => c !== "gateway" && !linked.includes(c));

// The map: gateway → each area card → the API cards it owns, one box per area.
const out = ["---", "config:", "  flowchart:", "    nodeSpacing: 48", "    rankSpacing: 160", "---", "flowchart LR"];
for (const a of areas) out.push(`  gateway --> ${a.id}`);
for (const a of areas) {
  out.push("", `  subgraph g_${a.id.replace(/-/g, "_")}[" "]`, `    ${a.id}`); // box title blank: the card's heading names the area
  for (const api of a.data.apis || []) out.push(`    ${a.id} --> ${api}`);
  for (const [from, to] of a.data.links || []) out.push(`    ${from} --> ${to}`);
  out.push("  end");
}
writeFileSync(join(dir, "_index.mmd"), out.join("\n") + "\n");

// Checks.
const owned = areas.flatMap((a) => a.data.apis || []);
const problems = [];
for (const c of apiCards) if (!owned.includes(c)) problems.push(`not owned by any area: ${c}`);
for (const c of owned) if (!cards.includes(c)) problems.push(`owned but no card: ${c}`);
owned.forEach((c, i) => { if (owned.indexOf(c) !== i) problems.push(`owned twice: ${c}`); });
for (const c of linked) if (!cards.includes(c)) problems.push(`linked but no card: ${c}`);

// `{pid}`, `{id}`, `<x>` and `[id]` all count as the same placeholder; query strings are ignored.
const norm = (s) => s.replace(/\{[A-Za-z]+\}|<[A-Za-z]+>|\[[A-Za-z]+\]/g, "{}").replace(/\?[^`\s"]*/g, "");
for (const a of areas) {
  const text = norm(a.raw);
  for (const c of a.data.apis || []) {
    if (!cards.includes(c)) continue;
    const line = readFileSync(join(dir, `${c}.md`), "utf8").split("\n")[1] || "";
    const path = norm(line.replace(/`/g, "").trim());
    if (path && !text.includes(path)) problems.push(`${a.id} owns ${c} but never mentions ${path}`);
  }
}

console.log(`${areas.length} areas, ${apiCards.length} API cards, ${linked.length} linked cards → _index.mmd`);
if (problems.length) { console.log(problems.map((p) => `  ✗ ${p}`).join("\n")); process.exit(1); }
console.log("  ✓ every API card is owned once and mentioned by its area");
