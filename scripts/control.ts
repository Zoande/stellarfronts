/**
 * CLI for the game orchestrator control API.
 *
 *   npm run control -- <command> [args]
 *
 * Commands:
 *   versions                              List versions (dev + registered, with commits)
 *   register-version <gitRef> [--id x] [--port n]   Pin a branch/tag/commit to a version
 *   unregister-version <id>               Remove a version + its worktree (no games may use it)
 *   games                                 List games (+version, status, endpoint)
 *   create-game <name> [--version v]
 *   reset-game <id>
 *   update-game <id> --to <version>
 *   compat --to <version>                 Dry-run: which games can update
 *   stop-game | start-game | archive-game | rollback-game <id>
 *   endpoint <id>
 */
const CONTROL_URL = process.env.CONTROL_URL ?? `http://localhost:${process.env.CONTROL_PORT ?? 8790}`;
const CONTROL_TOKEN = process.env.CONTROL_TOKEN ?? "dev-control-token";

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      flags[arg.slice(2)] = args[i + 1] ?? "";
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function call(method: "GET" | "POST" | "DELETE", pathname: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${CONTROL_URL}${pathname}`, {
    method,
    headers: { "content-type": "application/json", "x-control-token": CONTROL_TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${response.status}`);
  return json;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);
  switch (command) {
    case "versions":
      print(await call("GET", "/versions"));
      break;
    case "register-version":
      print(await call("POST", "/versions", { gitRef: positional[0], id: flags.id, port: flags.port ? Number(flags.port) : undefined }));
      break;
    case "unregister-version":
      print(await call("DELETE", `/versions/${positional[0]}`));
      break;
    case "games":
      print(await call("GET", "/games"));
      break;
    case "create-game":
      print(await call("POST", "/games", { name: positional[0], versionId: flags.version ?? "dev" }));
      break;
    case "reset-game":
      print(await call("POST", `/games/${positional[0]}/reset`));
      break;
    case "update-game":
      print(await call("POST", `/games/${positional[0]}/update`, { toVersion: flags.to }));
      break;
    case "compat":
      print(await call("GET", `/compat?to=${encodeURIComponent(flags.to ?? "")}`));
      break;
    case "stop-game":
      print(await call("POST", `/games/${positional[0]}/stop`));
      break;
    case "start-game":
      print(await call("POST", `/games/${positional[0]}/start`));
      break;
    case "archive-game":
      print(await call("POST", `/games/${positional[0]}/archive`));
      break;
    case "rollback-game":
      print(await call("POST", `/games/${positional[0]}/rollback`));
      break;
    case "endpoint":
      print(await call("POST", `/games/${positional[0]}/endpoint`));
      break;
    default:
      console.error(`Unknown command: ${command ?? "(none)"}. See scripts/control.ts header for usage.`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
