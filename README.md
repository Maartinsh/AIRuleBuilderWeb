# Rule Builder Web UI

Source mirror repo: https://github.com/Maartinsh/AIRuleBuilderWeb

When updating files here, push the changes to the mirror repo to deploy.

---

## Publishing & Versioning

Rules are published as named, timestamped versions stored in the `rules/` directory of the mirror repo. A lightweight `rules/manifest.json` index tracks all versions.

### Version ID format

```
YYYY-MM-DD-HHmm-{name}
```
Example: `2026-03-18-1430-demo-march`

- Date/time prefix is auto-generated (UTC) at publish time
- `{name}` is entered by the user — lowercase letters, numbers, and hyphens only
- Names must be **globally unique** across all versions

### Publish flow

1. Click **↑ Publish** in the toolbar
2. Enter a unique version name (e.g. `demo-march`)
3. Optionally add a description
4. Click **Publish** — the Netlify function writes the version file and updates the manifest

### Version Manager

Click **Versions · N** in the toolbar to open the version manager panel:
- Versions listed newest-first; top entry has a `latest` badge
- Search/filter by name or description
- **Load** — fetches the version's JSON and populates the rule editor
- **Delete** — removes the file from GitHub and updates the manifest

---

## Netlify Setup

The publish and delete functions run as Netlify serverless functions. Deploy the repo to Netlify and set the following environment variables in the **Netlify dashboard** (never in code):

| Variable         | Description |
|-----------------|-------------|
| `GITHUB_PAT`    | Fine-grained GitHub personal access token. Repo: `AIRuleBuilderWeb`. Permission: **Contents — Read & Write** |
| `PUBLISH_SECRET` | Shared team passphrase. Share with anyone who needs to publish or delete versions. |

The `netlify.toml` at the repo root configures:
- Functions directory: `netlify/functions/`
- Publish directory: `web-rule-builder/`

### Functions

| Function | Method | Description |
|----------|--------|-------------|
| `publish-rules` | POST | Validates passphrase, checks name uniqueness, writes version file + updates manifest |
| `delete-version` | DELETE | Validates passphrase, deletes version file + updates manifest |

---

## Mobile Integration

Mobile reads rules via raw GitHub URLs — no auth needed:

```
# Get version list (versions[0] is always the latest)
GET https://raw.githubusercontent.com/Maartinsh/AIRuleBuilderWeb/main/rules/manifest.json

# Fetch a specific version
GET https://raw.githubusercontent.com/Maartinsh/AIRuleBuilderWeb/main/rules/{versionId}.json
```

Version selection strategies:
- **Hardcoded**: set `RULES_VERSION = "2026-03-18-1430-demo-march"` in app config
- **Always-latest**: fetch manifest, read `versions[0].id`
- **Remote Config**: use Firebase Remote Config to change the version without an app update

Mobile calls `engine.reloadRules(fetchedJson)` as before — no SDK changes needed.

---

## MZONE Migration Path

When MZONE backend is ready, swap the Netlify function URLs (`/.netlify/functions/…`) for MZONE API endpoints, and the manifest/version raw GitHub URLs for MZONE CDN URLs. The rule JSON format, manifest structure, and mobile fetch pattern stay identical — zero mobile SDK changes needed.
