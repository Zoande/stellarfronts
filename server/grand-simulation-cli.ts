import { parseGrandOptions, runGrandSimulation } from "./game/grand-simulation";
import { analyzeCampaign } from "./game/campaign-analysis";

if (process.argv[2] === "--analyze") {
  if (!process.argv[3] || process.argv.length !== 4) throw new Error("Usage: npm run grandsimulation -- --analyze run-directory");
  await analyzeCampaign(process.argv[3]); console.log("Saved analysis.json and analysis.md in " + process.argv[3]);
} else if (process.argv.includes("--help")) {
  console.log("npm run grandsimulation -- [--hours 15] [--logging forensic|detailed|compact] [--max-data-gb 80] [--checkpoint-minutes 10] [--seed 42] [--out directory] [--checkpoint file.json.gz]\nDefaults: forensic, 15 hours, 80 GB soft budget. Near the budget, old completed logs are recompressed, then old intelligence/observation fields are reduced. All 15 AIs active, full default map, AI wars enabled, every production 100 ms tick. Ctrl+C saves and stops. No live servers or auth databases are used.");
} else {
  let stop: string | undefined;
  const interrupt = () => { stop = "interrupted"; console.log("Stopping after the current tick; saving checkpoint and logs. Please wait."); };
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  try { await runGrandSimulation({ ...parseGrandOptions(process.argv.slice(2)), shouldStop: () => stop }); }
  catch (error) { console.error(error); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
}
