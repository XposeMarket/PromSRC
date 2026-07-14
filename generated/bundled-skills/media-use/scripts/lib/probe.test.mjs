import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probe } from "./probe.mjs";

// Regression for the shell-injection fix: probe() must pass the path as a literal
// argv entry, never through a shell. The payload uses only characters legal in a
// real filename on the host OS. Under the old execSync interpolation, POSIX
// command substitution or Windows cmd.exe environment expansion creates the
// marker. Under execFileSync the filename remains a literal argv entry.
test("probe does not execute shell metacharacters in a filename", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-inject-"));
  const marker = join(dir, "INJECTED");
  const envName = "MEDIA_USE_PROBE_INJECT";
  const evilBasename =
    process.platform === "win32"
      ? `clip%${envName}%.mp4`
      : "clip$(touch INJECTED).mp4";
  const evil = join(dir, evilBasename);
  const prevCwd = process.cwd();
  const prevPayload = process.env[envName];
  try {
    if (process.platform === "win32") {
      // cmd.exe expands %NAME% before parsing. This value closes the old quoted
      // path and writes the marker, while remaining inert under literal argv.
      process.env[envName] = '" & type nul > INJECTED & rem "';
    }
    writeFileSync(evil, "not real media");
    process.chdir(dir); // a leaked payload would land next to `marker`
    const meta = probe(evil);
    assert.equal(existsSync(marker), false, "injected command must not have run");
    // Bogus/unreadable media still returns the null-shaped result, never throws.
    assert.deepEqual(Object.keys(meta).sort(), ["codec", "duration", "height", "width"]);
  } finally {
    process.chdir(prevCwd);
    if (prevPayload === undefined) delete process.env[envName];
    else process.env[envName] = prevPayload;
    rmSync(dir, { recursive: true, force: true });
  }
});
