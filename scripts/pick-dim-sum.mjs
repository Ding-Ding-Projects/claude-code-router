#!/usr/bin/env node
// Deterministically pick the next unused dim sum code name for a release.
//
//   node scripts/pick-dim-sum.mjs <catalog.json> <assets.tsv> <used-names.txt>
//
// Inputs:
// - <catalog.json>     the raw index from
//                      https://raw.githubusercontent.com/Ding-Ding-Projects/dim-sum-photos/main/catalog/index.json
// - <assets.tsv>       lines of "assetName\tbrowserDownloadUrl" listing every
//                      published release asset of Ding-Ding-Projects/dim-sum-photos
//                      (`gh api repos/.../releases --paginate
//                        -q '.[] | .assets[] | [.name, .browser_download_url] | @tsv'`)
// - <used-names.txt>   free text (prior release titles of THIS repository) in
//                      which an already-used code name must not reappear
//
// Output: zero or more lines in GitHub Actions $GITHUB_ENV format:
//   DIM_SUM_NAME_EN=<name.en>
//   DIM_SUM_NAME_ZH=<name.zhHant>
//   DIM_SUM_PHOTO_URL=<public download url of the dish's published png>
//
// Rules implemented here (policy):
// - Dishes are scanned in catalog order, so the choice is deterministic.
// - A dish whose English OR Traditional Chinese name already appears in a
//   prior release title is skipped: a code name is used once per repository.
// - Only dishes whose photo file is PUBLISHED as a real downloadable release
//   asset of the public photo repository are eligible. No image is ever
//   generated, downloaded into this repo, or substituted.
// - No eligible dish -> no output lines, exit 0. The caller ships the release
//   without a code name and says so. This script must never block a release.

import { readFileSync } from "node:fs";

const [catalogPath, assetsPath, usedPath] = process.argv.slice(2);
if (!catalogPath || !assetsPath || !usedPath) {
  console.error("usage: node scripts/pick-dim-sum.mjs <catalog.json> <assets.tsv> <used-names.txt>");
  process.exit(2);
}

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const dishes = Array.isArray(catalog?.dishes) ? catalog.dishes : [];

const publishedPhotos = new Map();
for (const line of readFileSync(assetsPath, "utf8").split("\n")) {
  const trimmed = line.replace(/\r$/, "");
  if (!trimmed) continue;
  const tabIndex = trimmed.indexOf("\t");
  if (tabIndex <= 0) continue;
  const name = trimmed.slice(0, tabIndex);
  const url = trimmed.slice(tabIndex + 1);
  if (name.toLowerCase().endsWith(".png") && /^https:\/\//.test(url)) {
    // First occurrence wins; duplicate asset names across releases are rare.
    if (!publishedPhotos.has(name)) publishedPhotos.set(name, url);
  }
}

let usedText = "";
try {
  usedText = readFileSync(usedPath, "utf8").toLowerCase();
} catch {
  usedText = ""; // no prior releases: every name is available
}

for (const dish of dishes) {
  const en = typeof dish?.name?.en === "string" ? dish.name.en.trim() : "";
  const zh = typeof dish?.name?.zhHant === "string" ? dish.name.zhHant.trim() : "";
  const imagePath = typeof dish?.image?.path === "string" ? dish.image.path : "";
  const baseName = imagePath.includes("/") ? imagePath.slice(imagePath.lastIndexOf("/") + 1) : imagePath;
  if (!en || !zh || !baseName) continue;

  const enLower = en.toLowerCase();
  if (usedText.includes(enLower) || usedText.includes(zh)) continue;

  const photoUrl = publishedPhotos.get(baseName);
  if (!photoUrl) continue; // photo not published yet: this dish is unavailable

  process.stdout.write(`DIM_SUM_NAME_EN=${en}\n`);
  process.stdout.write(`DIM_SUM_NAME_ZH=${zh}\n`);
  process.stdout.write(`DIM_SUM_PHOTO_URL=${photoUrl}\n`);
  process.exit(0);
}

process.exit(0); // nothing eligible: caller reports honestly and ships without a code name
