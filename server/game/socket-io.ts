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

export function sendEvent(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(event));
}

export function reject(socket: WebSocket, message: string): void {
  sendEvent(socket, { type: "commandResult", ok: false, message });
}

export function accept(socket: WebSocket, message: string): void {
  sendEvent(socket, { type: "commandResult", ok: true, message });
}
