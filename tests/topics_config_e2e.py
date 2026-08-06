import os
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("RULE_BUILDER_URL", "http://127.0.0.1:4173")


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        try:
            page.goto(BASE_URL, wait_until="networkidle")

            topic = page.evaluate(
                """
                () => {
                  const sel = document.getElementById('rule-topic');
                  sel.value = 'safety';
                  sel.dispatchEvent(new Event('change', { bubbles: true }));
                  return buildRuleJSON().topic;
                }
                """
            )
            assert topic == "safety", topic

            page.evaluate("updatePreview()")
            row = page.locator("#topic-list .rule-list-item", has_text="safety")
            row.wait_for(state="visible")
            row.click()

            page.locator('#topic-list [data-topic-field="precedence"]').fill("10")
            page.locator('#topic-list [data-topic-field="tone"]').fill("calm and firm")
            page.locator('#topic-list [data-topic-field="maxPerBatch"]').fill("2")
            page.locator('#topic-list [data-topic-field="cooldownMinutes"]').fill("30")
            page.locator('#topic-list [data-topic-field="maxTriggersPerDay"]').fill("5")

            doc = page.evaluate("() => { saveActiveRule(); return buildDocument(rules); }")
            assert doc["topics"]["safety"] == {
                "precedence": 10,
                "tone": "calm and firm",
                "maxPerBatch": 2,
                "throttle": {"cooldownMinutes": 30, "maxTriggersPerDay": 5},
            }, doc["topics"]
            assert doc["rules"][0]["topic"] == "safety"

            # Blanking a field must remove its key, and emptying the throttle
            # must remove the throttle object itself.
            page.locator('#topic-list [data-topic-field="precedence"]').fill("")
            page.locator('#topic-list [data-topic-field="cooldownMinutes"]').fill("")
            page.locator('#topic-list [data-topic-field="maxTriggersPerDay"]').fill("")
            cfg = page.evaluate("topicConfigs['safety']")
            assert "precedence" not in cfg, cfg
            assert "throttle" not in cfg, cfg

            # An exported envelope must survive a re-import unchanged.
            envelope = {
                "topics": {
                    "safety": {
                        "precedence": 7,
                        "tone": "steady",
                        "throttle": {"cooldownMinutes": 10, "maxTriggersPerDay": 3},
                    }
                },
                "rules": [
                    {
                        "id": "roundtrip_rule",
                        "topic": "safety",
                        "sessionScope": "global",
                        "output": {"instructions": "Round trip."},
                        "triggerExpression": {"type": "SINGLE", "dataSource": "SmartDrive"},
                    }
                ],
            }
            roundtrip = page.evaluate(
                """
                (doc) => {
                  if (document.activeElement) document.activeElement.blur();
                  _expandedTopic = null;
                  rules = doc.rules.map(migrateRule);
                  topicConfigs = _adoptTopicConfigs(doc.topics);
                  activeRuleIndex = 0;
                  populateFormFromRule(rules[0]);
                  updatePreview();
                  return buildDocument(rules);
                }
                """,
                envelope,
            )
            assert roundtrip["topics"] == envelope["topics"], roundtrip["topics"]
            assert roundtrip["rules"][0]["topic"] == "safety"

            # Config edits after an import land on top of the imported values.
            page.locator("#topic-list .rule-list-item", has_text="safety").click()
            precedence_input = page.locator('#topic-list [data-topic-field="precedence"]')
            assert precedence_input.input_value() == "7"
            precedence_input.fill("9")
            merged = page.evaluate("topicConfigs['safety']")
            assert merged["precedence"] == 9, merged
            assert merged["tone"] == "steady", merged

            print("topics_config_e2e: all assertions passed")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
