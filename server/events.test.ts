import assert from "node:assert/strict";
import { test } from "node:test";
import { EVENT_DEFINITIONS } from "../src/data/Events";
import { SITUATION_DEFINITIONS, getSituationDefinition } from "../src/data/Situations";
import { deriveIndicators } from "../src/data/Notifications";
import type { ActiveEvent } from "../src/data/Events";
import type { ActiveSituation } from "../src/data/Situations";

test("every event has a default choice that exists and a positive timeout (no-pause safety)", () => {
  for (const definition of Object.values(EVENT_DEFINITIONS)) {
    assert.ok(definition.choices.length > 0, `${definition.id} must have choices`);
    assert.ok(
      definition.choices.some((choice) => choice.id === definition.defaultChoiceId),
      `${definition.id} defaultChoiceId must reference a real choice`,
    );
    assert.ok(definition.timeoutDays > 0, `${definition.id} must have a positive timeout`);
  }
});

test("situation thresholds that trigger events reference real event definitions", () => {
  for (const situation of Object.values(SITUATION_DEFINITIONS)) {
    for (const threshold of situation.thresholds) {
      assert.ok(threshold.at > 0 && threshold.at <= situation.max);
      for (const effect of threshold.effects) {
        if (effect.type === "triggerEvent") {
          assert.ok(EVENT_DEFINITIONS[effect.eventId], `${situation.id} threshold references unknown event ${effect.eventId}`);
        }
      }
    }
  }
});

test("deriveIndicators surfaces events, situations (with progress) and resource alerts", () => {
  const event: ActiveEvent = {
    id: "evt-1",
    defId: "leaderRecruitmentOffer",
    factionId: 1,
    createdAtYear: 2300,
    expiresAtYear: 2300.5,
    title: "An Offer of Service",
    body: "...",
    category: "leader",
    choices: [{ id: "accept", label: "Accept", effects: [] }, { id: "decline", label: "Decline", effects: [] }],
    defaultChoiceId: "decline",
  };
  const situation: ActiveSituation = {
    id: "resourceShortage:food:1",
    defId: "resourceShortage",
    factionId: 1,
    subject: "food",
    progress: 62,
    startedAtYear: 2300,
    lastThreshold: 62,
  };
  const indicators = deriveIndicators({
    events: [event],
    situations: [situation],
    economy: {
      factionId: 1,
      stockpiles: { food: 0, minerals: 500, energy: 100, goods: 100, alloys: 100, research: 0 },
      monthlyDelta: { food: 0, minerals: -40, energy: 0, goods: 0, alloys: 0, research: 0 },
    } as never,
  });

  const eventIndicator = indicators.find((indicator) => indicator.kind === "event");
  assert.ok(eventIndicator, "event should produce an indicator");
  assert.equal(eventIndicator?.refId, "evt-1");

  const situationIndicator = indicators.find((indicator) => indicator.kind === "situation");
  assert.ok(situationIndicator, "situation should produce an indicator");
  assert.equal(situationIndicator?.progress, 62);
  assert.equal(situationIndicator?.refId, "resourceShortage:food:1");

  // minerals income is negative but stockpile is positive and not already a shortage → alert.
  assert.ok(indicators.some((indicator) => indicator.kind === "alert" && indicator.id.includes("minerals")));
  // food has a shortage situation so it should NOT also raise a deficit alert.
  assert.ok(!indicators.some((indicator) => indicator.kind === "alert" && indicator.id.includes("food")));
});

test("shortage situation escalates to a crisis event at 100", () => {
  const shortage = getSituationDefinition("resourceShortage");
  assert.ok(shortage);
  const crisis = shortage?.thresholds.find((threshold) => threshold.at === 100);
  assert.ok(crisis, "shortage should have a 100 threshold");
  assert.ok(crisis?.effects.some((effect) => effect.type === "triggerEvent"));
});
