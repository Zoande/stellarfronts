import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DIPLOMACY_CHAT_LIMIT_PER_PAIR,
  TRADE_PRIVILEGE_ARTICLE_ID,
  TREATY_DEFAULT_YEARS,
  TREATY_MAX_YEARS,
  TREATY_MIN_YEARS,
  areFactionsAtWar,
  clampTreatyDurationYears,
  createInitialDiplomacyState,
  getActiveTreatyPartnersForArticle,
  getBorderPolicy,
  normalizeDiplomacyState,
  setBorderPolicy,
} from "../src/data/Diplomacy";
import type { DiplomacyState } from "../src/data/Diplomacy";

test("diplomacy normalization migrates old saves to closed directional borders", () => {
  const normalized = normalizeDiplomacyState(undefined, [1, 2, 3]);

  assert.equal(normalized.changed, true);
  assert.equal(normalized.state.borders.length, 6);
  assert.equal(getBorderPolicy(normalized.state, 1, 2), "closed");
  assert.equal(getBorderPolicy(normalized.state, 2, 1), "closed");
  assert.equal(getBorderPolicy(normalized.state, 1, 1), "open");
});

test("border policies are directional", () => {
  const state = createInitialDiplomacyState([1, 2]);

  setBorderPolicy(state, 1, 2, "open");

  assert.equal(getBorderPolicy(state, 1, 2), "open");
  assert.equal(getBorderPolicy(state, 2, 1), "closed");
});

test("chat normalization keeps the newest 200 messages per country pair", () => {
  const chatMessages = Array.from({ length: DIPLOMACY_CHAT_LIMIT_PER_PAIR + 12 }, (_, index) => ({
    id: `message-${index}`,
    fromFactionId: index % 2 === 0 ? 1 : 2,
    toFactionId: index % 2 === 0 ? 2 : 1,
    body: `message ${index}`,
    createdAtYear: index,
  }));
  const normalized = normalizeDiplomacyState({ chatMessages }, [1, 2]);

  assert.equal(normalized.state.chatMessages.length, DIPLOMACY_CHAT_LIMIT_PER_PAIR);
  assert.equal(normalized.state.chatMessages[0]?.body, "message 12");
  assert.equal(normalized.state.chatMessages.at(-1)?.body, `message ${DIPLOMACY_CHAT_LIMIT_PER_PAIR + 11}`);
});

test("treaty duration validation clamps to configured bounds", () => {
  assert.equal(clampTreatyDurationYears("not a number"), TREATY_DEFAULT_YEARS);
  assert.equal(clampTreatyDurationYears(-10), TREATY_MIN_YEARS);
  assert.equal(clampTreatyDurationYears(250), TREATY_MAX_YEARS);
  assert.equal(clampTreatyDurationYears(14.4), 14);
});

test("wars drive active hostility state and ignore ended wars", () => {
  const active = normalizeDiplomacyState({
    wars: [{
      id: "war-1",
      attackerFactionId: 1,
      defenderFactionId: 2,
      startedAtYear: 2400,
      endedAtYear: null,
      preWarOwnership: [[0, 1]],
    }],
  }, [1, 2]).state;
  const ended = normalizeDiplomacyState({
    wars: [{
      id: "war-1",
      attackerFactionId: 1,
      defenderFactionId: 2,
      startedAtYear: 2400,
      endedAtYear: 2405,
      preWarOwnership: [[0, 1]],
    }],
  }, [1, 2]).state;

  assert.equal(areFactionsAtWar(active, 1, 2), true);
  assert.equal(areFactionsAtWar(ended, 1, 2), false);
});

test("trade privilege partners are removed while the treaty is suspended by war", () => {
  const base: DiplomacyState = normalizeDiplomacyState({
    treaties: [{
      id: "treaty-1",
      factionIds: [1, 2],
      articleIds: [TRADE_PRIVILEGE_ARTICLE_ID],
      proposedByFactionId: 1,
      acceptedByFactionId: 2,
      startedAtYear: 2400,
      minimumEndYear: 2410,
    }],
  }, [1, 2]).state;

  assert.deepEqual(getActiveTreatyPartnersForArticle(base, 1, TRADE_PRIVILEGE_ARTICLE_ID), [2]);

  base.wars.push({
    id: "war-1",
    attackerFactionId: 1,
    defenderFactionId: 2,
    startedAtYear: 2401,
    endedAtYear: null,
    preWarOwnership: [],
  });

  assert.deepEqual(getActiveTreatyPartnersForArticle(base, 1, TRADE_PRIVILEGE_ARTICLE_ID), []);
});
