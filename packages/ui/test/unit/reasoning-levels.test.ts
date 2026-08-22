import assert from "node:assert/strict";
import test from "node:test";
import {
  providerReasoningLevelOptions,
  reasoningEffortsFromLevels,
  reasoningLevelOptionsForModel,
  ultracodeReasoningEffort
} from "@ccr/ui/pages/home/shared/reasoning-levels.ts";

function levels(...efforts: string[]) {
  return efforts.map((effort) => ({ description: effort, effort }));
}

test("reasoning effort ladder lists every tier with ultracode last", () => {
  assert.deepEqual(
    providerReasoningLevelOptions.map((option) => option.effort),
    ["low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]
  );
});

test("ultracode outranks ultra and max in ladder order", () => {
  const efforts = providerReasoningLevelOptions.map((option) => option.effort);
  const ultracodeIndex = efforts.indexOf(ultracodeReasoningEffort);
  assert.ok(ultracodeIndex > 0, "ultracode must be present in the ladder");
  assert.ok(ultracodeIndex > efforts.indexOf("ultra"));
  assert.ok(ultracodeIndex > efforts.indexOf("max"));
});

test("every option pairs one effort with one label and description", () => {
  const seen = new Set<string>();
  for (const option of providerReasoningLevelOptions) {
    assert.ok(option.effort.length > 0 && !seen.has(option.effort), `duplicate effort ${option.effort}`);
    seen.add(option.effort);
    assert.equal(option.label.length > 0, true);
    assert.equal(option.description.length > 0, true);
  }
});

test("ultracode is offered only when backend defaults expose it", () => {
  const exposed = reasoningLevelOptionsForModel({ supportedReasoningLevels: levels("low", "ultracode") });
  assert.deepEqual(
    exposed.map((option) => option.effort),
    ["low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]
  );

  const notExposed = reasoningLevelOptionsForModel({ supportedReasoningLevels: levels("low", "ultra") });
  assert.deepEqual(
    notExposed.map((option) => option.effort),
    ["low", "medium", "high", "xhigh", "max", "ultra"]
  );

  assert.deepEqual(reasoningLevelOptionsForModel().map((option) => option.effort), [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra"
  ]);
});

test("a persisted ultracode selection stays editable even without defaults", () => {
  const options = reasoningLevelOptionsForModel(undefined, { supportedReasoningLevels: levels("high", "ultracode") });
  assert.ok(options.some((option) => option.effort === ultracodeReasoningEffort));
});

test("exposure matching trims and lowercases backend efforts", () => {
  const exposed = reasoningLevelOptionsForModel({ supportedReasoningLevels: levels(" ULTRACODE ", "Low") });
  assert.ok(exposed.some((option) => option.effort === ultracodeReasoningEffort));
  assert.deepEqual([...reasoningEffortsFromLevels(levels(" High "))], ["high"]);
});
