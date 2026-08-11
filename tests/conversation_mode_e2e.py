import os
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("RULE_BUILDER_URL", "http://127.0.0.1:4173")


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        try:
            page.goto(BASE_URL, wait_until="networkidle")

            # Automatic is the default and must not appear in the document at all,
            # so rules authored before this feature export byte-identically.
            assert page.locator("#rule-conversation").input_value() == "auto"
            assert "conversation" not in page.evaluate("buildRuleJSON()")

            page.select_option("#rule-conversation", "manual")
            assert page.evaluate("buildRuleJSON().conversation") == "manual"

            # Manual rules are called out in the rule list.
            page.evaluate(
                """
                () => {
                  document.getElementById('rule-id').value = 'manual_rule';
                  saveActiveRule();
                  renderRuleList();
                }
                """
            )
            row = page.locator("#rule-list .rule-list-item", has_text="manual_rule")
            row.wait_for(state="visible")
            assert "manual" in row.locator(".rule-list-scope").inner_text()

            # The engine parses the value case-insensitively; import normalizes it
            # so the schema enum (auto|manual) still accepts what we publish.
            roundtrip = page.evaluate(
                """
                (doc) => {
                  rules = doc.rules.map(migrateRule);
                  activeRuleIndex = 0;
                  populateFormFromRule(rules[0]);
                  updatePreview();
                  return {
                    field: document.getElementById('rule-conversation').value,
                    built: buildRuleJSON().conversation,
                  };
                }
                """,
                {
                    "rules": [
                        {
                            "id": "imported_rule",
                            "conversation": "MANUAL",
                            "sessionScope": "global",
                            "output": {"instructions": "Only on request."},
                            "triggerExpression": {"type": "SINGLE", "dataSource": "SmartDrive"},
                        }
                    ]
                },
            )
            assert roundtrip["field"] == "manual", roundtrip
            assert roundtrip["built"] == "manual", roundtrip

            # An unknown mode is not a value the builder can represent; it falls back
            # to automatic on import, matching the engine's own fallback.
            fallback = page.evaluate(
                """
                (rule) => {
                  const migrated = migrateRule(rule);
                  populateFormFromRule(migrated);
                  return {
                    key: 'conversation' in migrated,
                    field: document.getElementById('rule-conversation').value,
                  };
                }
                """,
                {
                    "id": "odd_rule",
                    "conversation": "voice",
                    "sessionScope": "global",
                    "output": {"instructions": "Whatever."},
                    "triggerExpression": {"type": "SINGLE", "dataSource": "SmartDrive"},
                },
            )
            assert fallback["key"] is False, fallback
            assert fallback["field"] == "auto", fallback

            print("conversation_mode_e2e: all assertions passed")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
