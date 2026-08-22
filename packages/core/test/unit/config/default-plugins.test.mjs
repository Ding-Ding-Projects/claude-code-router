import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAUDE_DESIGN_PLUGIN_ID,
  CLAUDE_SHIP_PLUGIN_ID,
  DEFAULT_CLAUDE_DESIGN_APP,
  DEFAULT_CLAUDE_SHIP_APP,
  KNOWN_GATEWAY_PLUGIN_DEFAULTS
} from "@ccr/core/contracts/app.ts";
import { createDefaultAppConfig, createDefaultGatewayPlugins } from "@ccr/core/config/default-config.ts";
import { migrateKnownGatewayPluginConfigsForTest } from "@ccr/core/config/config.ts";

test("fresh default config pre-registers Claude Design and Claude Ship plugins enabled", () => {
  const config = createDefaultAppConfig();
  const plugins = config.plugins ?? [];

  const design = plugins.find((plugin) => plugin.id === CLAUDE_DESIGN_PLUGIN_ID);
  assert.ok(design, "claude-design is missing from the default plugins");
  assert.equal(design.enabled, true);
  assert.deepEqual(design.apps, [{ ...DEFAULT_CLAUDE_DESIGN_APP }]);
  assert.deepEqual(design.permissions, [...KNOWN_GATEWAY_PLUGIN_DEFAULTS[CLAUDE_DESIGN_PLUGIN_ID].permissions]);
  assert.deepEqual(design.surfaces, { ...KNOWN_GATEWAY_PLUGIN_DEFAULTS[CLAUDE_DESIGN_PLUGIN_ID].surfaces });

  const ship = plugins.find((plugin) => plugin.id === CLAUDE_SHIP_PLUGIN_ID);
  assert.ok(ship, "claude-ship is missing from the default plugins");
  assert.equal(ship.enabled, true);
  assert.deepEqual(ship.apps, [{ ...DEFAULT_CLAUDE_SHIP_APP }]);
  assert.deepEqual(ship.permissions, [...KNOWN_GATEWAY_PLUGIN_DEFAULTS[CLAUDE_SHIP_PLUGIN_ID].permissions]);
  assert.deepEqual(ship.surfaces, { ...KNOWN_GATEWAY_PLUGIN_DEFAULTS[CLAUDE_SHIP_PLUGIN_ID].surfaces });
});

test("default plugin entries carry no machine-specific module path", () => {
  for (const plugin of createDefaultGatewayPlugins()) {
    assert.equal(plugin.module, undefined, `${plugin.id} must resolve its module at desktop runtime`);
  }
});

test("every defaults build returns fresh plugin entries", () => {
  const first = createDefaultAppConfig();
  const second = createDefaultAppConfig();

  assert.notEqual(first.plugins, second.plugins);
  assert.notEqual(first.plugins.find((plugin) => plugin.id === CLAUDE_DESIGN_PLUGIN_ID), second.plugins.find((plugin) => plugin.id === CLAUDE_DESIGN_PLUGIN_ID));

  const mutated = first.plugins.find((plugin) => plugin.id === CLAUDE_SHIP_PLUGIN_ID);
  mutated.enabled = false;
  mutated.apps.length = 0;

  assert.equal(second.plugins.find((plugin) => plugin.id === CLAUDE_SHIP_PLUGIN_ID).enabled, true);
  assert.equal(second.plugins.find((plugin) => plugin.id === CLAUDE_SHIP_PLUGIN_ID).apps.length, 1);
});

test("user config without a plugins array still receives both enabled defaults", () => {
  // Mirrors the loadAppConfig seam: picked.plugins ?? DEFAULT_CONFIG.plugins.
  const pickedPlugins = undefined;
  const result = migrateKnownGatewayPluginConfigsForTest(pickedPlugins ?? createDefaultGatewayPlugins());

  assert.equal(result.changed, false);
  assert.deepEqual(
    result.plugins.map((plugin) => [plugin.id, plugin.enabled]),
    [
      [CLAUDE_DESIGN_PLUGIN_ID, true],
      [CLAUDE_SHIP_PLUGIN_ID, true]
    ]
  );
});

test("an explicit user plugins list replaces the defaults and disables cleanly", () => {
  // A non-empty user plugins array wins wholesale over the defaults, so a
  // disabled claude-design entry stays disabled and claude-ship is NOT
  // re-injected behind the user's back.
  const userPlugins = [
    { enabled: false, id: CLAUDE_DESIGN_PLUGIN_ID },
    { enabled: true, id: "cursor-proxy" }
  ];
  const result = migrateKnownGatewayPluginConfigsForTest(userPlugins);

  assert.equal(result.changed, false);
  assert.deepEqual(result.plugins.map((plugin) => plugin.id), [CLAUDE_DESIGN_PLUGIN_ID, "cursor-proxy"]);
  assert.equal(result.plugins.find((plugin) => plugin.id === CLAUDE_DESIGN_PLUGIN_ID).enabled, false);
  assert.equal(result.plugins.some((plugin) => plugin.id === CLAUDE_SHIP_PLUGIN_ID), false);
});
