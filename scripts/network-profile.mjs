import { readdir, stat, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { gzipSync, brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, "dist");
const PUBLIC_DIR = path.join(ROOT, "public");
const TMP_DIR = path.join(ROOT, "tmp");

const TEXT_EXTS = new Set([
  ".js",
  ".css",
  ".html",
  ".json",
  ".svg",
  ".txt",
  ".glsl",
  ".vert",
  ".frag",
  ".mtl",
  ".obj",
  ".gltf",
]);

const ASSET_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".avif",
  ".ktx2",
  ".dds",
  ".tga",
  ".gif",
  ".mp3",
  ".wav",
  ".ogg",
  ".mp4",
  ".webm",
  ".glb",
]);

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath));
    } else if (entry.isFile()) {
      const info = await stat(fullPath);
      const rel = path.relative(ROOT, fullPath).replace(/\\/g, "/");
      const ext = path.extname(fullPath).toLowerCase() || "(none)";
      files.push({ path: fullPath, rel, ext, size: info.size });
    }
  }
  return files;
}

function summarizeFiles(files) {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const byExt = new Map();
  for (const file of files) {
    byExt.set(file.ext, (byExt.get(file.ext) ?? 0) + file.size);
  }
  const byExtSorted = Array.from(byExt.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([ext, size]) => ({ ext, size }));

  const topFiles = [...files]
    .sort((a, b) => b.size - a.size)
    .slice(0, 15)
    .map((file) => ({ rel: file.rel, size: file.size }));

  return { total, byExt: byExtSorted, topFiles };
}

function groupByFolder(files, depth = 2) {
  const buckets = new Map();
  for (const file of files) {
    const parts = file.rel.split("/");
    const key = parts.slice(0, depth).join("/");
    buckets.set(key, (buckets.get(key) ?? 0) + file.size);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([key, size]) => ({ key, size }));
}

function isTextFile(file) {
  return TEXT_EXTS.has(file.ext);
}

function compressionSizes(buffer) {
  const gzip = gzipSync(buffer, { level: 9 }).length;
  let brotli = null;
  try {
    brotli = brotliCompressSync(buffer, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).length;
  } catch {
    brotli = null;
  }
  return { gzip, brotli };
}

async function computeInitialLoad(distFiles) {
  const indexPath = path.join(DIST_DIR, "index.html");
  if (!(await exists(indexPath))) return null;
  const html = await readFile(indexPath, "utf8");
  const refs = new Set();
  const regex = /(src|href)="([^"]+)"/g;
  let match;
  while ((match = regex.exec(html))) {
    const ref = match[2];
    if (ref.startsWith("http")) continue;
    if (!ref.includes(".js") && !ref.includes(".css")) continue;
    refs.add(ref.replace(/^\//, ""));
  }

  const files = [];
  const indexStat = await stat(indexPath);
  files.push({ path: indexPath, rel: "dist/index.html", ext: ".html", size: indexStat.size });

  for (const ref of refs) {
    const fullPath = path.join(DIST_DIR, ref);
    if (!(await exists(fullPath))) continue;
    const info = await stat(fullPath);
    files.push({
      path: fullPath,
      rel: path.relative(ROOT, fullPath).replace(/\\/g, "/"),
      ext: path.extname(fullPath).toLowerCase() || "(none)",
      size: info.size,
    });
  }

  let raw = 0;
  let gzip = 0;
  let brotli = 0;
  for (const file of files) {
    raw += file.size;
    if (isTextFile(file)) {
      const buffer = await readFile(file.path);
      const compressed = compressionSizes(buffer);
      gzip += compressed.gzip;
      brotli += compressed.brotli ?? 0;
    }
  }

  return {
    files: files.map((file) => ({ rel: file.rel, size: file.size })),
    raw,
    gzip,
    brotli,
  };
}

async function requestJson(url, method, body, headers = {}) {
  const payload = body ? Buffer.from(JSON.stringify(body)) : null;
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": payload.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const text = buffer.toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: buffer,
            json,
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function jsonSize(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function recordStats(target, bytes) {
  target.count += 1;
  target.total += bytes;
  target.min = Math.min(target.min ?? bytes, bytes);
  target.max = Math.max(target.max ?? bytes, bytes);
}

async function runNetworkProfile() {
  const authUrl = process.env.AUTH_SERVER_URL ?? "http://localhost:8788";
  const wsUrl = process.env.WS_URL ?? "ws://localhost:8787";
  const origin = process.env.WS_ORIGIN ?? "http://localhost:5173";
  const idleDurationMs = Number(process.env.WS_IDLE_MS ?? 10_000);

  const loginPayload = { username: "observer", password: "observer" };
  const loginStart = Date.now();
  const loginRes = await requestJson(`${authUrl}/api/login`, "POST", loginPayload);
  const loginElapsedMs = Date.now() - loginStart;
  const setCookieHeader = Array.isArray(loginRes.headers["set-cookie"])
    ? loginRes.headers["set-cookie"][0]
    : loginRes.headers["set-cookie"] ?? "";
  const sessionCookie = String(setCookieHeader).split(";")[0];

  const authSummary = {
    status: loginRes.status,
    elapsedMs: loginElapsedMs,
    requestBytes: Buffer.byteLength(JSON.stringify(loginPayload)),
    responseBytes: loginRes.body.length,
    cookieBytes: Buffer.byteLength(setCookieHeader),
  };

  const wsStats = {
    serverInfoBytes: 0,
    snapshotBytes: 0,
    snapshotFields: {},
    updates: { count: 0, total: 0, min: null, max: null },
    updateFields: {},
    systemDetailsBytes: 0,
    planetDetailsBytes: 0,
    updateDurationMs: idleDurationMs,
  };

  let snapshot = null;
  let systemDetailsResolve;
  let planetDetailsResolve;
  const systemDetailsPromise = new Promise((resolve) => { systemDetailsResolve = resolve; });
  const planetDetailsPromise = new Promise((resolve) => { planetDetailsResolve = resolve; });

  const socket = new WebSocket(wsUrl, {
    headers: { Cookie: sessionCookie, Origin: origin },
  });

  const opened = new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });

  socket.on("message", (data) => {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    const bytes = raw.length;
    let parsed;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }

    if (parsed.type === "serverInfo") {
      wsStats.serverInfoBytes = bytes;
      return;
    }
    if (parsed.type === "snapshot") {
      wsStats.snapshotBytes = bytes;
      snapshot = parsed;
      wsStats.snapshotFields = {
        clock: jsonSize(parsed.clock),
        stars: jsonSize(parsed.stars),
        planetStates: jsonSize(parsed.planetStates),
        factionEconomies: jsonSize(parsed.factionEconomies),
        habitedPlanetSystemIds: jsonSize(parsed.habitedPlanetSystemIds),
        hyperlanes: jsonSize(parsed.hyperlanes),
        factions: jsonSize(parsed.factions),
        starOwnership: jsonSize(parsed.starOwnership),
        visibleStarIds: jsonSize(parsed.visibleStarIds),
        knownStarIds: jsonSize(parsed.knownStarIds),
        ships: jsonSize(parsed.ships),
        shipDesigns: jsonSize(parsed.shipDesigns),
        fleets: jsonSize(parsed.fleets),
        starbases: jsonSize(parsed.starbases),
        recentCombatContacts: jsonSize(parsed.recentCombatContacts),
      };
      return;
    }
    if (parsed.type === "update") {
      recordStats(wsStats.updates, bytes);
      if (Array.isArray(parsed.changed)) {
        for (const field of parsed.changed) {
          if (field in parsed) {
            const fieldBytes = jsonSize(parsed[field]);
            const entry = wsStats.updateFields[field] ?? { count: 0, total: 0, min: null, max: null };
            recordStats(entry, fieldBytes);
            wsStats.updateFields[field] = entry;
          }
        }
      }
      return;
    }
    if (parsed.type === "systemDetails") {
      wsStats.systemDetailsBytes = bytes;
      systemDetailsResolve(parsed);
      return;
    }
    if (parsed.type === "planetDetails") {
      wsStats.planetDetailsBytes = bytes;
      planetDetailsResolve(parsed);
    }
  });

  await opened;
  socket.send(JSON.stringify({ type: "join" }));

  const snapshotWait = Date.now();
  while (!snapshot) {
    if (Date.now() - snapshotWait > 8000) {
      throw new Error("Timed out waiting for snapshot.");
    }
    await delay(50);
  }

  await delay(idleDurationMs);

  const starId = snapshot.stars?.[0]?.id ?? 0;
  if (Number.isInteger(starId)) {
    socket.send(JSON.stringify({ type: "requestSystemDetails", starId }));
    await Promise.race([systemDetailsPromise, delay(5000)]);
  }

  const planetId = snapshot.planetStates?.[0]?.id ?? null;
  if (planetId) {
    socket.send(JSON.stringify({ type: "requestPlanetDetails", planetId }));
    await Promise.race([planetDetailsPromise, delay(5000)]);
  }

  socket.close();

  return { authSummary, wsStats };
}

async function runAssetProfile() {
  const report = {};
  if (await exists(DIST_DIR)) {
    const distFiles = await walkFiles(DIST_DIR);
    report.dist = {
      summary: summarizeFiles(distFiles),
      folderTotals: groupByFolder(distFiles, 2),
      initialLoad: await computeInitialLoad(distFiles),
    };

    let textRaw = 0;
    let textGzip = 0;
    let textBrotli = 0;
    for (const file of distFiles) {
      if (!isTextFile(file)) continue;
      const buffer = await readFile(file.path);
      const compressed = compressionSizes(buffer);
      textRaw += file.size;
      textGzip += compressed.gzip;
      textBrotli += compressed.brotli ?? 0;
    }
    report.dist.textCompression = { raw: textRaw, gzip: textGzip, brotli: textBrotli };
  }

  if (await exists(PUBLIC_DIR)) {
    const publicFiles = await walkFiles(PUBLIC_DIR);
    const assetsOnly = publicFiles.filter((file) => ASSET_EXTS.has(file.ext));
    report.public = {
      summary: summarizeFiles(publicFiles),
      assetsOnly: summarizeFiles(assetsOnly),
      folderTotals: groupByFolder(publicFiles, 2),
    };
  }

  return report;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const skipAssets = args.has("--network-only");
  const skipNetwork = args.has("--assets-only");

  const report = { generatedAt: new Date().toISOString() };

  if (!skipAssets) {
    report.assets = await runAssetProfile();
  }
  if (!skipNetwork) {
    report.network = await runNetworkProfile();
  }

  await mkdir(TMP_DIR, { recursive: true });
  const outputPath = path.join(TMP_DIR, "network-report.json");
  await writeFile(outputPath, JSON.stringify(report, null, 2));

  console.log("Network profiling complete.");
  console.log(`Report: ${path.relative(ROOT, outputPath).replace(/\\/g, "/")}`);

  if (report.assets?.dist?.initialLoad) {
    const initial = report.assets.dist.initialLoad;
    console.log("Initial load (index + entry assets):", formatBytes(initial.raw));
    if (Number.isFinite(initial.gzip)) console.log("  gzip:", formatBytes(initial.gzip));
    if (Number.isFinite(initial.brotli)) console.log("  brotli:", formatBytes(initial.brotli));
  }
  if (report.network?.wsStats?.updates?.count) {
    const updates = report.network.wsStats.updates;
    const perSecond = updates.total / Math.max(1, report.network.wsStats.updateDurationMs / 1000);
    console.log("Updates:", updates.count, "avg", formatBytes(updates.total / updates.count), "per sec", formatBytes(perSecond));
  }
}

main().catch((error) => {
  console.error("Network profiling failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
