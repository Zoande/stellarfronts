import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AuthStore } from "./auth-store";
import type { AuthAccount } from "../src/auth/types";

function requireAccount(account: AuthAccount | null): AuthAccount {
  assert.ok(account);
  return account;
}

test("multi-game auth store claims generated countries per game", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "stellarfronts-auth-"));
  const store = new AuthStore(path.join(directory, "auth.sqlite"));
  const colorAccounts = Array.from({ length: 15 }, (_, index) => (
    requireAccount(store.getAccountByUsername(`color_${index + 1}`))
  ));
  const observer = requireAccount(store.getAccountByUsername("observer"));
  const admin = requireAccount(store.getAccountByUsername("admin"));
  const game = store.createGame("Alpha Front");

  assert.equal(colorAccounts[0].accountType, "user");
  assert.equal(colorAccounts[0].factionId, null);
  assert.deepEqual(store.getGamePerspective(observer, game.id), { mode: "observer" });
  assert.deepEqual(store.getGamePerspective(admin, game.id), { mode: "observer" });
  assert.equal(store.getGamePerspective(colorAccounts[0], game.id), null);

  const first = store.joinGame(colorAccounts[0], game.id, "Solar Assembly");
  const second = store.joinGame(colorAccounts[1], game.id, "Solar Assembly");
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.factionId, second.factionId);
  assert.equal(first.countryName, second.countryName);
  assert.deepEqual(store.getGamePerspective(colorAccounts[0], game.id), {
    mode: "faction",
    factionId: first.factionId,
  });

  const permanent = store.joinGame(colorAccounts[0], game.id, "Renamed Later");
  assert.deepEqual(permanent, first);

  for (const account of colorAccounts.slice(2)) {
    store.joinGame(account, game.id, `Claim ${account.username}`);
  }

  const signup = store.signup({ username: "latecomer", password: "latecomer" }).account;
  assert.throws(() => store.joinGame(signup, game.id, "Late Country"), /Game is full/);

  const summaries = store.getGameSummariesForAccount(colorAccounts[0]);
  assert.equal(summaries[0].controlledCountries, 15);
  assert.equal(summaries[0].isFull, true);
  assert.equal(summaries[0].isJoined, true);
  assert.equal(summaries[0].membership?.countryName, "Solar Assembly");
});
