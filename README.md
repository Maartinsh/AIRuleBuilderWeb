## Publishing & Versioning

Rules are published under MZone.

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
