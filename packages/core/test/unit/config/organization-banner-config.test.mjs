import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("organization banner config parsing enforces the documented bounds", async () => {
  const { organizationBannerConfigFromRawForTest } = await import("@ccr/core/config/config.ts");

  // Non-object payloads fall back to the default (disabled) banner.
  assert.equal(organizationBannerConfigFromRawForTest(undefined), undefined);
  assert.equal(organizationBannerConfigFromRawForTest("banner"), undefined);
  assert.equal(organizationBannerConfigFromRawForTest([true]), undefined);

  // A well-formed banner keeps its trimmed text and image URL.
  assert.deepEqual(
    organizationBannerConfigFromRawForTest({
      enabled: true,
      imageUrl: "  https://example.com/logo.png  ",
      text: "  Maintenance window at noon  "
    }),
    {
      enabled: true,
      imageUrl: "https://example.com/logo.png",
      text: "Maintenance window at noon"
    }
  );
});

test("organization banner config clamps text and drops unusable image URLs", async () => {
  const { ORGANIZATION_BANNER_IMAGE_URL_MAX_LENGTH, ORGANIZATION_BANNER_TEXT_MAX_LENGTH } = await import("@ccr/core/contracts/app.ts");
  const { organizationBannerConfigFromRawForTest } = await import("@ccr/core/config/config.ts");

  const longText = "x".repeat(ORGANIZATION_BANNER_TEXT_MAX_LENGTH + 50);
  const parsedLongText = organizationBannerConfigFromRawForTest({ enabled: true, text: longText });
  assert.equal(parsedLongText.text.length, ORGANIZATION_BANNER_TEXT_MAX_LENGTH);

  // Non-http(s) schemes are dropped, never truncated into broken URLs.
  for (const badUrl of ["ftp://example.com/logo.png", "javascript:alert(1)", "/assets/logo.png", "https://", "not a url"]) {
    const parsed = organizationBannerConfigFromRawForTest({ enabled: true, imageUrl: badUrl, text: "hi" });
    assert.equal(parsed.imageUrl, undefined, `expected ${badUrl} to be dropped`);
  }

  const longUrl = `https://example.com/${"a".repeat(ORGANIZATION_BANNER_IMAGE_URL_MAX_LENGTH)}.png`;
  assert.ok(longUrl.length > ORGANIZATION_BANNER_IMAGE_URL_MAX_LENGTH);
  const parsedLongUrl = organizationBannerConfigFromRawForTest({ enabled: true, imageUrl: longUrl, text: "hi" });
  assert.equal(parsedLongUrl.imageUrl, undefined);

  // Non-boolean enabled values are treated as disabled.
  const parsedEnabled = organizationBannerConfigFromRawForTest({ enabled: "yes", text: "hi" });
  assert.equal(parsedEnabled.enabled, false);
});

test("organization banner config round-trips through the persisted app config store", async () => {
  const homeRoot = process.env.CCR_INTERNAL_HOME_DIR || path.join(os.tmpdir(), `ccr-organization-banner-test-${process.pid}`);
  const testRoot = path.join(homeRoot, `organization-banner-round-trip-${process.pid}`);
  process.env.CCR_INTERNAL_HOME_DIR = path.join(testRoot, "home");
  process.env.CCR_INTERNAL_APP_DATA_DIR = path.join(testRoot, "app-data");
  process.env.CCR_INTERNAL_USER_DATA_DIR = path.join(testRoot, "user-data");
  mkdirSync(testRoot, { recursive: true });

  const { ConfigRepository } = await import("@ccr/core/config/config-repository.ts");
  const repository = new ConfigRepository(path.join(testRoot, "home", "config.sqlite"));
  const stored = {
    organizationBanner: {
      enabled: true,
      imageUrl: "https://example.com/banner.png",
      text: "Team standup moved to 10:30"
    }
  };

  await repository.replaceAppConfig(stored);
  const readBack = await repository.readAppConfig();
  assert.deepEqual(readBack, stored);
});
