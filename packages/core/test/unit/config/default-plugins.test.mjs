import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Every @ccr/core/config module resolves its storage paths from these env vars
// at import time, so they MUST be isolated before the first dynamic import
// below. That keeps loadAppConfig()'s real loader path - sqlite store included
// - reading and writing a throwaway directory instead of the developer's own
// configuration.
const isolatedRoot = path.join(
  process.env.CCR_INTERNAL_HOME_DIR || os.tmpdir(),
  `default-plugins-${process.pid}-${Date.now()}`
);
process.env.CCR_INTERNAL_HOME_DIR = path.join(isolatedRoot, "home");
process.env.CCR_INTERNAL_APP_DATA_DIR = path.join(isolatedRoot, "app-data");
process.env.CCR_INTERNAL_USER_DATA_DIR = path.join(isolatedRoot, "user-data");
mkdirSync(process.env.CCR_INTERNAL_USER_DATA_DIR, { recursive: true });

// Loaded lazily (the esbuild bundle compiles tests to cjs, so no top-level
// await) and only after the env isolation above.
let modules;
async function loadModules() {
  modules ??= {
    config: await import("@ccr/core/config/config.ts"),
    contracts: await import("@ccr/core/contracts/app.ts"),
    defaults: await import("@ccr/core/config/default-config.ts")
  };
  return modules;
}

function assertDefaultPluginShape(contracts, plugin, pluginId) {
  const defaults = contracts.KNOWN_GATEWAY_PLUGIN_DEFAULTS[pluginId];
  assert.equal(plugin.enabled, true);
  assert.deepEqual(plugin.apps, [pluginId === contracts.CLAUDE_DESIGN_PLUGIN_ID
    ? { ...contracts.DEFAULT_CLAUDE_DESIGN_APP }
    : { ...contracts.DEFAULT_CLAUDE_SHIP_APP }]);
  assert.deepEqual(plugin.permissions, [...defaults.permissions]);
  assert.deepEqual(plugin.surfaces, { ...defaults.surfaces });
}

test("fresh default config pre-registers Claude Design and Claude Ship plugins enabled", async () => {
  const { contracts, defaults } = await loadModules();
  const config = defaults.createDefaultAppConfig();
  const plugins = config.plugins ?? [];

  const design = plugins.find((plugin) => plugin.id === contracts.CLAUDE_DESIGN_PLUGIN_ID);
  assert.ok(design, "claude-design is missing from the default plugins");
  assertDefaultPluginShape(contracts, design, contracts.CLAUDE_DESIGN_PLUGIN_ID);

  const ship = plugins.find((plugin) => plugin.id === contracts.CLAUDE_SHIP_PLUGIN_ID);
  assert.ok(ship, "claude-ship is missing from the default plugins");
  assertDefaultPluginShape(contracts, ship, contracts.CLAUDE_SHIP_PLUGIN_ID);
});

test("default plugin entries carry no machine-specific module path", async () => {
  const { defaults } = await loadModules();
  for (const plugin of defaults.createDefaultGatewayPlugins()) {
    assert.equal(plugin.module, undefined, `${plugin.id} must resolve its module at desktop runtime`);
  }
});

test("every defaults build returns fresh plugin entries", async () => {
  const { contracts, defaults } = await loadModules();
  const first = defaults.createDefaultAppConfig();
  const second = defaults.createDefaultAppConfig();

  assert.notEqual(first.plugins, second.plugins);
  assert.notEqual(first.plugins.find((plugin) => plugin.id === contracts.CLAUDE_DESIGN_PLUGIN_ID), second.plugins.find((plugin) => plugin.id === contracts.CLAUDE_DESIGN_PLUGIN_ID));

  const mutated = first.plugins.find((plugin) => plugin.id === contracts.CLAUDE_SHIP_PLUGIN_ID);
  mutated.enabled = false;
  mutated.apps.length = 0;

  assert.equal(second.plugins.find((plugin) => plugin.id === contracts.CLAUDE_SHIP_PLUGIN_ID).enabled, true);
  assert.equal(second.plugins.find((plugin) => plugin.id === contracts.CLAUDE_SHIP_PLUGIN_ID).apps.length, 1);
});

test("loadAppConfig injects both enabled defaults when persisted config has no plugins array", async () => {
  // Exercises the real seam instead of hand-mirroring it: with no persisted
  // value for plugins, loadAppConfig must fall back to the default gateway
  // plugins exactly as production does.
  const { config, contracts } = await loadModules();
  const loaded = await config.loadAppConfig();

  assert.deepEqual(
    (loaded.plugins ?? []).map((plugin) => [plugin.id, plugin.enabled]),
    [
      [contracts.CLAUDE_DESIGN_PLUGIN_ID, true],
      [contracts.CLAUDE_SHIP_PLUGIN_ID, true]
    ]
  );
});

test("an explicit user plugins list replaces the defaults and disables cleanly", async () => {
  // A non-empty user plugins array wins wholesale over the defaults, so a
  // disabled claude-design entry stays disabled and claude-ship is NOT
  // re-injected behind the user's back.
  const { config, contracts } = await loadModules();
  const userPlugins = [
    { enabled: false, id: contracts.CLAUDE_DESIGN_PLUGIN_ID },
    { enabled: true, id: "cursor-proxy" }
  ];
  const result = config.migrateKnownGatewayPluginConfigsForTest(userPlugins);

  assert.equal(result.changed, false);
  assert.deepEqual(result.plugins.map((plugin) => plugin.id), [contracts.CLAUDE_DESIGN_PLUGIN_ID, "cursor-proxy"]);
  assert.equal(result.plugins.find((plugin) => plugin.id === contracts.CLAUDE_DESIGN_PLUGIN_ID).enabled, false);
  assert.equal(result.plugins.some((plugin) => plugin.id === contracts.CLAUDE_SHIP_PLUGIN_ID), false);
});
