// =============================================================================
// Low-level WebSocket send helpers — extracted from server/index.ts
//
// These are pure functions over a single socket (no RuntimeContext). Command
// handlers in any module can import them to emit results without depending on
// the runtime closure. Broadcast helpers (which fan out over ctx.clients) stay
// with the runtime in index.ts.
// =============================================================================

import { WebSocket } from "ws";
import type { ServerEvent } from "../../src/game/GameProtocol";

export type CommandResultStatus = "accepted" | "rejected";

const commandRequestIds = new WeakMap<WebSocket, string>();
const commandResultStatuses = new WeakMap<WebSocket, CommandResultStatus>();

export function beginCommandResult(socket: WebSocket, requestId?: string): void {
  commandResultStatuses.delete(socket);
  if (requestId) commandRequestIds.set(socket, requestId);
  else commandRequestIds.delete(socket);
}

export function consumeCommandResultStatus(socket: WebSocket): CommandResultStatus | undefined {
  const status = commandResultStatuses.get(socket);
  commandResultStatuses.delete(socket);
  commandRequestIds.delete(socket);
  return status;
}

export function sendEvent(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(event));
}

export function reject(socket: WebSocket, message: string): void {
  commandResultStatuses.set(socket, "rejected");
  sendEvent(socket, {
    type: "commandResult",
    ok: false,
    message,
    requestId: commandRequestIds.get(socket),
  });
}

export function accept(socket: WebSocket, message: string): void {
  commandResultStatuses.set(socket, "accepted");
  sendEvent(socket, {
    type: "commandResult",
    ok: true,
    message,
    requestId: commandRequestIds.get(socket),
  });
}
