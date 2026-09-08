import json
import os
import urllib.request
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("RULE_BUILDER_URL", "http://127.0.0.1:4173")

# Minimal rule with no topic: the shape that used to export as a bare array and
# so had nowhere to carry schemaVersion.
PLAIN_RULE = {
    "id": "plain_rule",
    "sessionScope": "global",
    "output": {"instructions": "Say something."},
    "triggerExpression": {
        "type": "SINGLE",
        "id": "trip_started",
        "dataSource": "SmartDrive",
        "conditions": [],
    },
}

TYPED_VALUE_RULE = {
    **PLAIN_RULE,
    "triggerExpression": {
        **PLAIN_RULE["triggerExpression"],
        "conditions": [
            {"type": "Value", "parameter": "speed", "operator": ">=", "value": 50}
        ],
    },
}

SEARCH_RULE = {
    **PLAIN_RULE,
    "triggerExpression": {
        "type": "SINGLE",
        "id": "google_nearby_gas_station",
        "dataSource": "External Source",
        "conditions": [],
        "search": {"mode": "nearby", "radius": 5000},
    },
}


def main():
    with urllib.request.urlopen(f"{BASE_URL}/rule-schema.json") as res:
        schema = json.load(res)

    # The contract stamps the version it was generated at. Without it the builder
    # falls back to a literal that nothing keeps honest.
    stamped = schema.get("x-schemaVersion")
    assert stamped, "rule-schema.json carries no x-schemaVersion — re-sync it from contract/"
    released = schema.get("x-releasedSchema")
    assert released, "rule-schema.json carries no x-releasedSchema — re-sync it from contract/"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        try:
            page.goto(BASE_URL, wait_until="networkidle")

            assert page.evaluate("SCHEMA_VERSION") == stamped
            assert page.evaluate("RELEASED_SCHEMA_VERSION") == released

            doc = page.evaluate("(rule) => buildDocument([rule])", PLAIN_RULE)
            assert not isinstance(doc, list), "a topic-less set must still be an envelope"
            # An empty topics registry would be noise in every export that uses none.
            assert "topics" not in doc, doc.keys()
            assert doc["rules"][0]["id"] == "plain_rule"

            # The stamp describes the document, not the builder. A set using nothing past the
            # baseline must stay loadable on engines released before the newer grammar existed.
            assert doc["schemaVersion"] == "1.0.0", doc["schemaVersion"]
            assert page.evaluate("(r) => requiredSchemaVersion([r])", TYPED_VALUE_RULE) == "1.1.0"
            assert page.evaluate("(r) => requiredSchemaVersion([r])", SEARCH_RULE) == "1.2.0"
            # The floor is the whole set's, not the last rule's.
            mixed = page.evaluate(
                "(rules) => buildDocument(rules).schemaVersion", [SEARCH_RULE, PLAIN_RULE]
            )
            assert mixed == "1.2.0", mixed

            topical = page.evaluate(
                "(rule) => buildDocument([{ ...rule, topic: 'safety' }])", PLAIN_RULE
            )
            assert topical["topics"] == {"safety": {}}, topical["topics"]

            # A set needing more than the fleet has must say so where the author will see it.
            def warnings(rules):
                return page.evaluate("(rules) => validateRule(rules).warnings", rules)

            gated = [w for w in warnings([SEARCH_RULE]) if "reject the whole document" in w]
            assert gated, warnings([SEARCH_RULE])
            assert not [w for w in warnings([PLAIN_RULE]) if "reject the whole document" in w]

            # The engine rejects a version outside its supported range, so a stamp
            # the bundle does not claim to support is a release-breaking typo.
            low, high = schema["x-supportedSchema"].split("..")
            assert _tuple(low) <= _tuple(stamped) <= _tuple(high), schema["x-supportedSchema"]
            assert _tuple(released) <= _tuple(stamped), (released, stamped)

            print("schema_version_e2e: all assertions passed")
        finally:
            browser.close()


def _tuple(version):
    return tuple(int(part) for part in version.split("."))


if __name__ == "__main__":
    main()
