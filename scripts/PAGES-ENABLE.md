# Enabling GitHub Pages for this repository (workflow deployment)

One-time, owner-only setup for `.github/workflows/pages.yml`. Enabling Pages and
changing its build type requires a token with **repository administration**
rights (a plain `repo` scope token is refused). Run these from any machine with
`gh` signed in as an admin of `Ding-Ding-Projects/claude-code-router`.

The pipeline deploys through the Actions build type (`build_type=workflow`),
meaning GitHub never builds anything itself — the workflow's
`actions/deploy-pages@v4` step publishes the uploaded artifact.

## 1. Enable Pages with `build_type=workflow`

```bash
gh api -X POST repos/Ding-Ding-Projects/claude-code-router/pages \
  -H "Accept: application/vnd.github+json" \
  -f build_type=workflow
```

- `HTTP 201`: created — continue to step 2.
- `HTTP 409` with a message that Pages configuration already exists: Pages was
  already enabled some other way; switch it to workflow builds instead:

  ```bash
  gh api -X PUT repos/Ding-Ding-Projects/claude-code-router/pages \
    -H "Accept: application/vnd.github+json" \
    -f build_type=workflow
  ```

## 2. Confirm the setting took

```bash
gh api repos/Ding-Ding-Projects/claude-code-router/pages --jq '{build_type: .build_type, url: .html_url}'
```

Expect:

```json
{"build_type":"workflow","url":"https://ding-ding-projects.github.io/claude-code-router/"}
```

If `build_type` still reads `legacy`, step 1's PUT did not land — rerun it.

## 3. Trigger the first deployment

```bash
gh workflow run pages.yml --repo Ding-Ding-Projects/claude-code-router
gh run list --repo Ding-Ding-Projects/claude-code-router --workflow pages.yml --limit 1
```

Watch it to the end (`gh run watch <run-id>`); the `Deploy to GitHub Pages`
job must finish green before anything exists at the URL.

## 4. Verify the deployed URL

Base path is `/claude-code-router/`, so the site root is:

```
https://ding-ding-projects.github.io/claude-code-router/
```

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' https://ding-ding-projects.github.io/claude-code-router/
# expect: 200

curl -fsS https://ding-ding-projects.github.io/claude-code-router/ | head -n 5
# expect real HTML whose asset references all start with /claude-code-router/

curl -fsS -o /dev/null -w '%{http_code}\n' https://ding-ding-projects.github.io/claude-code-router/styles.css
# expect 200 — repeat for one or two emitted JS/CSS assets

gh api repos/Ding-Ding-Projects/claude-code-router/pages --jq .status
# expect: built
```

## 5. Optional housekeeping

- Point the repository homepage field at the site so it renders in the sidebar:

  ```bash
  gh repo edit Ding-Ding-Projects/claude-code-router \
    --homepage "https://ding-ding-projects.github.io/claude-code-router/"
  ```

- After setup, everything is automatic: every push to `main` touching
  `site/**`, `scripts/build-site.mjs`, or `.github/workflows/pages.yml`
  redeploys; use `gh workflow run pages.yml` for manual runs.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `403` on the POST/PUT in step 1 | Token lacks admin rights on the repository. |
| Deploy job fails: "not allowed to deploy to github-pages" | Pages is not yet enabled with `build_type=workflow`, or the auto-created `github-pages` environment restricts deployment branches so `main` is excluded — fix under Settings → Environments → github-pages. |
| Site 404s at `https://ding-ding-projects.github.io/` | Expected. The site is built for the `/claude-code-router/` base path; open the subpath URL from step 4. |
| Deployed page loads but assets 404 | A reference escaped the base-path assertion; check the failing run's "Assert index.html exists..." step output, which names every offending file and reference. |
| Two workflows deploy to the same Pages site | This repo also has `docs.yml` (Astro docs) publishing to Pages. Both cannot own the same URL — coordinate their owners so only one publishes per path before merging both lanes. |
