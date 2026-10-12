import { parseGrandOptions, runGrandSimulation } from "./game/grand-simulation";
import { analyzeCampaign } from "./game/campaign-analysis";
import { monitorGrandProcess } from "./game/grand-process";
import { openGrandSession } from "./game/grand-session";

if (process.argv[2] === "--analyze") {
  if (!process.argv[3] || process.argv.length !== 4) throw new Error("Usage: npm run grandsimulation -- --analyze run-directory");
  await analyzeCampaign(process.argv[3]); console.log("Saved analysis.json and analysis.md in " + process.argv[3]);
} else if (process.argv.includes("--help")) {
  console.log("npm run grandsimulation -- [--session directory] [--hours 15] [--logging forensic|detailed|compact] [--max-data-gb 80] [--checkpoint-minutes 10] [--seed 42] [--out directory] [--checkpoint file.json.gz]\nDefaults: forensic, 15 hours, 80 GB soft budget. All 15 AIs active, full default map, AI wars enabled, every production 100 ms tick. Ctrl+C saves and stops. --session automatically resumes completed checkpoints after a crash, using separate segments and the original wall deadline. No live servers or auth databases are used.");
} else {
  const args = process.argv.slice(2), index = args.indexOf("--session");
  let session: ReturnType<typeof openGrandSession>;
  if (index >= 0) {
    const directory = args[index + 1];
    if (!directory || directory.startsWith("--") || args.includes("--out")) throw new Error("--session requires a directory and cannot be combined with --out.");
    args.splice(index, 2);
    session = openGrandSession(directory, parseGrandOptions(args));
    if (!session) { console.log("Session already finished or its time/storage budget is exhausted."); process.exit(0); }
  }
  const options = session?.options ?? parseGrandOptions(args);
  let stop: string | undefined;
  const monitor = monitorGrandProcess(options.output, reason => {
    stop = reason; console.log(`${new Date().toISOString()} Stop requested; saving checkpoint and logs. Please wait.`);
  });
  try {
    const result = await runGrandSimulation({ ...options, shouldStop: () => stop ?? options.shouldStop?.(), onStatus: monitor.status });
    session?.finish(result.stopReason); monitor.finish();
  } catch (error) { monitor.finish(error); console.error(error); process.exitCode = 1; }
  finally { session?.release(); }
}
