// Syntax-check every browser module under static/, so a new file can never be left out.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(path);
    }
    // Finder duplicates ("app 2.js") are never part of the project.
    return /\.m?js$/.test(entry.name) && !/ \d+\.m?js$/.test(entry.name) ? [path] : [];
  });
}

const files = walk(join(root, "static"));
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(`✗ ${relative(root, file)}\n${result.stderr}\n`);
  }
}
if (failed) {
  process.stderr.write(`${failed} of ${files.length} files failed the syntax check.\n`);
  process.exit(1);
}
console.log(`Syntax OK: ${files.length} modules in static/`);
