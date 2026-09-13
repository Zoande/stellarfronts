import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { decodeClientCommand } from "../game/client-command-codec";
import {
  accept,
  beginCommandResult,
  consumeCommandResultStatus,
  reject,
} from "../game/socket-io";

function capturingSocket(events: unknown[]): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send(payload: string) {
      events.push(JSON.parse(payload));
    },
  } as unknown as WebSocket;
}

test("protocol 8 command request IDs are bounded at the trust boundary", () => {
  assert.equal(
    decodeClientCommand({ type: "moveFleet", fleetId: "f", targetStarId: 1, requestId: "cmd-1" }).requestId,
    "cmd-1",
  );
  assert.throws(() => decodeClientCommand({ type: "moveFleet", requestId: "" }), /requestId/);
  assert.throws(
    () => decodeClientCommand({ type: "moveFleet", requestId: "x".repeat(129) }),
    /requestId/,
  );
  assert.throws(() => decodeClientCommand({ type: "moveFleet", requestId: 3 }), /requestId/);
});

test("normal command outcomes echo only their exact request ID", () => {
  const events: unknown[] = [];
  const socket = capturingSocket(events);

  beginCommandResult(socket, "cmd-a");
  accept(socket, "Moved.");
  assert.equal(consumeCommandResultStatus(socket), "accepted");

  beginCommandResult(socket, "cmd-b");
  reject(socket, "Blocked.");
  assert.equal(consumeCommandResultStatus(socket), "rejected");

  assert.deepEqual(events, [
    { type: "commandResult", ok: true, message: "Moved.", requestId: "cmd-a" },
    { type: "commandResult", ok: false, message: "Blocked.", requestId: "cmd-b" },
  ]);
});
