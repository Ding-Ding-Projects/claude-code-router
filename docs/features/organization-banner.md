# Organization banner

> **Status:** implemented on a feature branch and in code review. This article describes the target state agreed for the current release cycle; see [HANDOFF](../../HANDOFF.md) for the exact verification position before treating any behavior below as shipped.

Teams that share one CCR instance can now put a small identity strip at the top of the management UI: an organization banner with a name and, optionally, an image. It is plain configuration — nothing is hardcoded — and it disappears completely when disabled.

## Overview

- New persisted config block `organizationBanner` in `~/.claude-code-router/config.json`:

  ```json
  {
    "organizationBanner": {
      "enabled": true,
      "text": "Acme Platform Engineering",
      "imageUrl": "https://example.com/acme-logo.png"
    }
  }
  ```

- Field contract:

  | Field | Type | Constraint |
  | --- | --- | --- |
  | `enabled` | boolean | Master switch for the whole feature |
  | `text` | string | Required label, maximum **200 characters** |
  | `imageUrl` | string, optional | Must be an **https** URL, maximum **500 characters** |

- When enabled, an M3-styled header strip renders on the management UI Home showing the text (and the image when provided).
- When disabled — or when the block is absent entirely — no strip renders at all: not a blank bar, not placeholder chrome. Hidden means hidden.

## Behavior

### Rendering

- The strip sits at the top of the Home surface and uses the same Material Design 3 tokens as the rest of the UI (see [Material Design 3 management UI](./material-design-3-ui.md)), so it follows light/dark theming automatically.
- The image, when set, renders beside the text at a fixed height inside the strip.
- The text renders as plain text, never as markup.

### Editing

- **Settings inputs:** a toggle plus two fields in the management UI settings surface. Validation runs inline while typing: over-length text is rejected with a clear message naming the 200-character limit; non-https or over-length image URLs are rejected naming the https and 500-character rules.
- **Direct file edit:** editing `~/.claude-code-router/config.json` works identically; values are validated on load, and an invalid block is treated as unset rather than partially applied.

## Configuration

| Want to… | Do this |
| --- | --- |
| Show the banner | Set `enabled: true`, provide `text`, optionally provide an https `imageUrl` |
| Hide the banner | Set `enabled: false` (or delete the block); the strip vanishes from Home |
| Change branding later | Update `text`/`imageUrl`; changes apply to the running UI without reinstalling anything |

The banner is local configuration for your instance. It is not synced anywhere and does not alter gateway routing, providers, or agent profiles in any way.

## Failure modes

| Situation | Behavior |
| --- | --- |
| `enabled: false` or block missing | No strip rendered; Home layout otherwise unchanged |
| `text` longer than 200 characters | Rejected in settings inline; a hand-edited over-length value is treated as invalid and the block is treated as unset |
| `imageUrl` using `http://` (not https) | Rejected; the banner never loads mixed-content assets |
| `imageUrl` longer than 500 characters | Rejected with the limit named |
| Image URL valid but unreachable / slow / broken | Text still renders; the strip stays functional and shows its alt/fallback treatment instead of breaking layout |
| Malformed JSON or wrong types in the block | Treated as unset — feature off, no crash, no partial application |

## Security notes

- **https only:** remote images must be served over https so the local management UI never pulls mixed-content resources.
- **Text, not HTML:** banner text is escaped/rendered as text, so a banner value cannot inject markup or script into the UI.
- **No tracking by us:** loading the image is a direct fetch of the URL you configured; CCR adds no analytics, referrer tricks, or third-party wrappers around it. Choose an image host you trust, since that host sees requests from machines showing the banner.
- Banner content lives only in local config and request logs never include it.

## Verification

Planned and implemented checks for this feature:

- Unit tests cover validation boundaries exactly: 200/201-character text, 500/501-character URLs, http vs https, missing optional field, malformed block, and disabled state.
- Persistence round-trip tests confirm settings edits land in `config.json` and survive restart.
- UI checks confirm the strip renders on Home when enabled in both themes, and is fully absent (not blank) when disabled.

**Current status:** implementation is in review; the checks above have not yet been run to green against an integrated build. Do not tick this off in the [roadmap](../../ROADMAP.md) until they have.

## Suggested next articles

- [Material Design 3 management UI](./material-design-3-ui.md) — the token system the strip is styled with.
- [Reasoning effort: ultracode](./reasoning-effort-ultracode.md) — the other picker-visible addition this cycle.
- [Roadmap](../../ROADMAP.md) — future banner options under consideration.
