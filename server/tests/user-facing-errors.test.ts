import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyGameBootFailure,
  classifyRequestFailure,
  getUserErrorCopy,
  type UserErrorKind,
} from "../../src/errors/UserFacingErrors";

const ERROR_KINDS: UserErrorKind[] = [
  "serviceUnavailable", "sessionExpired", "pageNotFound", "gameStarting",
  "gameUnavailable", "gameStopped", "gameNotFound", "gameFull",
  "connectionLost", "updateRequired", "unexpected",
];

test("every reachable player error has concise, complete copy", () => {
  for (const kind of ERROR_KINDS) {
    const copy = getUserErrorCopy(kind);
    assert.ok(copy.label.trim(), `${kind} label`);
    assert.ok(copy.title.trim(), `${kind} title`);
    assert.ok(copy.message.trim(), `${kind} message`);
    assert.ok(copy.message.length <= 160, `${kind} message is too long`);
    assert.equal(copy.message.includes("\n"), false, `${kind} message must remain scannable`);
  }
});

test("request failures map technical transport details to safe player states", () => {
  assert.equal(classifyRequestFailure(new TypeError("fetch failed")), "serviceUnavailable");
  assert.equal(classifyRequestFailure({ status: 401 }), "sessionExpired");
  assert.equal(classifyRequestFailure({ status: 500 }), "serviceUnavailable");
  assert.equal(classifyRequestFailure({ status: 503 }), "serviceUnavailable");
  assert.equal(classifyRequestFailure({ status: 404 }), null);
  assert.equal(classifyRequestFailure(new Error("ordinary rejection")), null);
});

test("game boot failures conceal protocol details behind the compatibility page", () => {
  assert.equal(classifyGameBootFailure(new Error("Unsupported protocol v99")), "updateRequired");
  assert.equal(classifyGameBootFailure(new Error("PROTOCOL changed")), "updateRequired");
  assert.equal(classifyGameBootFailure(new Error("socket refused")), "gameUnavailable");
  assert.equal(classifyGameBootFailure("unknown"), "gameUnavailable");
});
