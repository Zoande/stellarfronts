import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AuthStore } from "../auth-store";
import { WEEKLY_QUESTS } from "../game/progression";
import type { AuthAccount } from "../../src/auth/types";
import type { SpeciesSetup } from "../../src/data/Species";

function requireAccount(account: AuthAccount | null): AuthAccount {
  assert.ok(account);
  return account;
}

test("dark matter is account-scoped and awarded once for progression rewards", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "stellarfronts-auth-"));
  const store = new AuthStore(path.join(directory, "auth.sqlite"));
  const account = store.signup({ username: "darkmatter", password: "darkmatter" }).account;

  assert.equal(store.getPlayerDarkMatter(account.id), 0);
  assert.deepEqual(store.checkAndUnlockAchievements(account.id), ["first-contact"]);
  assert.equal(store.getPlayerDarkMatter(account.id), 1);

  const quest = WEEKLY_QUESTS[0];
  const windowKey = "test-window";
  store.upsertQuestProgress(account.id, quest.id, windowKey, quest.target, quest.target);
  const reward = store.claimQuestReward(account.id, quest.id, windowKey);
  assert.ok(reward);
  assert.equal(reward.xpGained, quest.xpReward);
  assert.equal(reward.darkMatterGained, quest.darkMatterReward);
  assert.ok(reward.newDarkMatter >= 1 + quest.darkMatterReward);

  const balanceAfterClaim = store.getPlayerDarkMatter(account.id);
  assert.equal(store.claimQuestReward(account.id, quest.id, windowKey), null);
  assert.equal(store.getPlayerDarkMatter(account.id), balanceAfterClaim);

  const profile = store.buildPlayerProfile(account);
  assert.equal(profile.darkMatter, balanceAfterClaim);
  assert.equal(
    profile.achievements.find((achievement) => achievement.id === "first-contact")?.darkMatterReward,
    1,
  );
});

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

  const speciesSetup: SpeciesSetup = {
    speciesName: "Solari",
    archetypeId: "avian",
    traitIds: ["intelligent", "delicate"],
  };
  const first = store.joinGame(colorAccounts[0], game.id, "Solar Assembly", undefined, speciesSetup);
  const second = store.joinGame(colorAccounts[1], game.id, "Solar Assembly");
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.factionId, second.factionId);
  assert.equal(first.countryName, second.countryName);
  assert.ok(first.flagDesign?.container.id);
  assert.deepEqual(first.speciesSetup, speciesSetup);
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
  assert.deepEqual(summaries[0].membership?.speciesSetup, speciesSetup);
});

test("auth store rejects invalid species trait payloads", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "stellarfronts-auth-"));
  const store = new AuthStore(path.join(directory, "auth.sqlite"));
  const account = requireAccount(store.getAccountByUsername("color_1"));
  const game = store.createGame("Beta Front");

  assert.throws(
    () => store.joinGame(account, game.id, "Invalid Species", undefined, {
      speciesName: "Invalids",
      archetypeId: "humanoid",
      traitIds: ["adaptive", "adaptive"],
    }),
    /Duplicate species traits/,
  );
});

test("auth store manages public news posts comments and votes", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "stellarfronts-auth-"));
  const store = new AuthStore(path.join(directory, "auth.sqlite"));
  const admin = requireAccount(store.getAccountByUsername("admin"));
  const user = store.signup({ username: "commenter", password: "commenter" }).account;
  const voter = store.signup({ username: "voter", password: "voter" }).account;

  const draft = store.createNewsPost(admin, {
    title: "June Development Report",
    summary: "A focused report on the current test galaxy.",
    coverImageUrl: null,
    blocks: [{ id: "intro-block", type: "paragraph", text: "The next front is being prepared." }],
    status: "draft",
  });

  assert.equal(store.listNewsPosts().length, 0);
  assert.equal(store.getNewsPostBySlug(draft.slug), null);
  assert.throws(
    () => store.createNewsPost(user, {
      title: "User Post",
      summary: "This should not be accepted.",
      blocks: [],
      status: "draft",
    }),
    /Administrator account required/,
  );

  const published = store.updateNewsPost(admin, draft.id, {
    title: draft.title,
    summary: draft.summary,
    coverImageUrl: null,
    blocks: draft.blocks,
    status: "published",
  });

  assert.equal(store.listNewsPosts().length, 1);
  assert.equal(store.getNewsPostBySlug(published.slug)?.title, "June Development Report");

  const comment = store.createNewsComment(user, published.slug, "Looking forward to the next update.");
  assert.equal(comment.score, 0);
  assert.equal(comment.userVote, 0);

  const voted = store.voteNewsComment(voter, comment.id, 1);
  assert.equal(voted.score, 1);
  assert.equal(voted.userVote, 1);

  const publicPostForVoter = store.getNewsPostBySlug(published.slug, voter);
  assert.equal(publicPostForVoter?.comments.length, 1);
  assert.equal(publicPostForVoter?.comments[0].score, 1);
  assert.equal(publicPostForVoter?.comments[0].userVote, 1);

  const cleared = store.voteNewsComment(voter, comment.id, 0);
  assert.equal(cleared.score, 0);
  assert.equal(cleared.userVote, 0);
});
