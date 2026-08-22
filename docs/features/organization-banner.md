# Organization banner

> **Status: implementation in review.** This article describes the target state of the
> organization banner landing on the `feat/org-banner` branch. Nothing below has been
> verified against a built artifact yet — see [Verification](#verification).

## Behavior

The management UI can render an organization banner: an M3-styled header strip at the
top of the home surface, intended for a team or deployment name and optional logo.

- The banner is driven by a persisted configuration object:

  ```json
  {
    "organizationBanner": {
      "enabled": true,
      "text": "Acme Engineering",
      "imageUrl": "https://example.com/logo.png"
    }
  }
  ```

- `enabled` — boolean switch for the whole feature.
- `text` — the banner copy, limited to 200 characters.
- `imageUrl` — optional logo image URL, limited to 500 characters and required to be
  `https`.

When enabled with non-empty text, the home surface renders the strip showing the text
and, when provided and loadable, the image. When disabled, the strip is **hidden
entirely** — it is not rendered at all rather than merely concealed, so no disabled
banner markup, empty container, or placeholder reaches the page.

The setting persists in CCR's configuration database alongside every other setting, so
it survives restarts and is included in configuration export/backup like the rest of the
stored settings.

## Configuration

Managed from the settings surface:

1. Open **Settings** in the management UI.
2. Locate the organization banner inputs: an enable toggle, a text field capped at 200
   characters, and an optional image URL field capped at 500 characters.
3. Save. Validation runs inline at save time (see below), and the home strip reflects
   the change immediately.

There is no gateway-side effect: the banner is presentation state for the management UI
and never alters routing, requests, or provider behavior.

## Failure modes

- **Text over 200 characters** — rejected at save with inline validation; nothing is
  persisted partially.
- **Image URL over 500 characters or not `https`** — rejected at save. Plain `http`
  URLs are not accepted as a fallback.
- **Image fails to load at render time** (unreachable host, expired link, bad content
  type) — the strip degrades gracefully to text only instead of showing a broken image
  or blocking the home surface.
- **Invalid or corrupt stored value** (for example, a hand-migrated database row that
  violates the schema) — treated as disabled; the UI renders without a banner rather
  than rendering malformed content.
- **Disabled state** — the strip is absent from the DOM entirely; there is no hidden
  element carrying stale text.

## Security notes

- The image URL is restricted to `https` so the renderer never fetches banner artwork
  over plaintext, avoiding mixed-content downgrade on remote deployments.
- The banner image loads without credentials attached — no cookies, tokens, or provider
  keys are sent to the image origin, so a banner URL cannot be used to exfiltrate
  session material.
- Banner text is rendered as text through the normal component path, not injected as
  HTML, so banner content cannot introduce markup or script into the management UI.
- The banner is cosmetic and carries no authority: it does not gate any action, does not
  appear in API responses, and is excluded from anything that would treat it as a trust
  signal.

## Verification

Not yet run — the implementation is in review. Planned checks once the branch lands,
against the built artifact:

1. Persistence round trip: set text and an `https` image URL, restart, confirm both
   survive via the configuration database.
2. Validation: attempt a 201-character text and an `http://` image URL; confirm both are
   rejected inline and nothing partial persists.
3. Rendering: confirm the M3-styled strip appears on home when enabled and disappears
   from the rendered DOM entirely when disabled.
4. Image fallback: point `imageUrl` at an unreachable host and confirm the strip renders
   text only.

Until those steps produce real captures, treat this article as describing intent, not a
verified release.

## Suggested next articles

- [Material Design 3 management UI](./material-design-3-ui.md) — the token layer the
  banner strip is styled with.
- [Ultracode reasoning effort](./reasoning-effort-ultracode.md) — the new top effort
  tier exposed in the model catalog and pickers.
