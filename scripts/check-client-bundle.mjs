import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DIST_DIR = new URL("../dist/", import.meta.url);
const ASSET_DIR = new URL("../dist/assets/", import.meta.url);
const INITIAL_ENTRY_LIMIT = 450 * 1024;

const format = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const indexHtml = await readFile(new URL("index.html", DIST_DIR), "utf8");
const entryMatch = indexHtml.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/);

if (!entryMatch) {
  throw new Error("Client bundle budget: could not find the initial JavaScript entry in dist/index.html");
}

const entryName = entryMatch[1];
const entrySize = (await stat(join(fileURLToPath(ASSET_DIR), entryName))).size;
const failures = [];

if (entrySize > INITIAL_ENTRY_LIMIT) {
  failures.push(`initial entry ${entryName} is ${format(entrySize)} (limit ${format(INITIAL_ENTRY_LIMIT)})`);
}

if (failures.length > 0) {
  throw new Error(`Client bundle budget exceeded:\n- ${failures.join("\n- ")}`);
}

console.log(`Client bundle budget OK: initial entry ${format(entrySize)}.`);
