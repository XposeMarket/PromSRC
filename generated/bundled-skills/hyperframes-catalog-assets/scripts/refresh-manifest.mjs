#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, "..");
const prometheusRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const manifestPath = join(skillRoot, "resources", "catalog-manifest.json");
const categoryMapPath = join(skillRoot, "resources", "category-map.md");
const wrapperPath = join(prometheusRoot, "scripts", "run-hyperframes.js");
let hyperframesVersion = "unknown";
try {
  hyperframesVersion = JSON.parse(
    readFileSync(join(prometheusRoot, "node_modules", "hyperframes", "package.json"), "utf8"),
  ).version;
} catch {
  // Keep the inventory refresh usable in packaged layouts without node_modules.
}

const result = spawnSync(process.execPath, [wrapperPath, "catalog", "--json"], {
  cwd: prometheusRoot,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true,
});
if (result.status !== 0) {
  throw new Error(result.stderr || `hyperframes catalog exited ${result.status}`);
}

const live = JSON.parse(result.stdout);
if (!Array.isArray(live) || live.length === 0) {
  throw new Error("hyperframes catalog returned no items");
}
const duplicateNames = live
  .map((item) => item.name)
  .filter((name, index, names) => names.indexOf(name) !== index);
if (duplicateNames.length) {
  throw new Error(`duplicate catalog names: ${[...new Set(duplicateNames)].join(", ")}`);
}

const previous = JSON.parse(readFileSync(manifestPath, "utf8"));
const previousBySlug = new Map((previous.items || []).map((item) => [item.slug, item]));
const items = live.map((item) => {
  const prior = previousBySlug.get(item.name);
  const kind = item.type === "component" ? "components" : "blocks";
  return {
    slug: item.name,
    name: item.title || item.name,
    kind,
    type: `hyperframes:${item.type}`,
    category: prior?.category || (item.type === "component" ? "Components" : "Blocks"),
    description: item.description || "",
    tags: Array.isArray(item.tags) ? item.tags : [],
    ...(item.dimensions ? { dimensions: item.dimensions } : {}),
    ...(Number.isFinite(item.duration) ? { duration: item.duration } : {}),
    prometheusUse:
      prior?.prometheusUse || `Adapt the official ${item.title || item.name} ${item.type}.`,
  };
});

const manifest = {
  ...previous,
  source: {
    ...previous.source,
    capturedAt: new Date().toISOString().slice(0, 10),
    catalogCommand: "hyperframes catalog --json",
    hyperframesVersion,
  },
  itemCount: items.length,
  items,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const groups = new Map([
  ["Blocks", items.filter((item) => item.kind === "blocks")],
  ["Components", items.filter((item) => item.kind === "components")],
]);
const lines = [
  "# HyperFrames Catalog Category Map",
  "",
  "Generated from the pinned Prometheus HyperFrames CLI. The JSON manifest is the canonical inventory; this file is a compact browsing index.",
  "",
  `Total: **${items.length}** official registry items.`,
  "",
];
for (const [label, group] of groups) {
  lines.push(`## ${label} (${group.length})`, "");
  for (const item of group) {
    const tags = item.tags.length ? ` — ${item.tags.join(", ")}` : "";
    lines.push(`- ${item.name} — \`${item.slug}\`${tags}`);
  }
  lines.push("");
}
writeFileSync(categoryMapPath, `${lines.join("\n").trim()}\n`);

console.log(JSON.stringify({ ok: true, itemCount: items.length, manifestPath, categoryMapPath }));
