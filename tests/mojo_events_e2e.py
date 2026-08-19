import os
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("RULE_BUILDER_URL", "http://127.0.0.1:4173")

EXPECTED_EVENTS = [
    "app_open",
    "patient_info",
    "session_start",
    "session_completed",
    "session_abandoned",
    "exercise_completed",
    "exercise_skipped",
]


def select_mojo_trigger(page, event_name):
    page.evaluate(
        """
        (eventName) => {
          const trigger = document.getElementById('trigger-root');
          const ds = trigger.querySelector('[data-field="dataSource"]');
          ds.value = 'Mojo';
          ds.dispatchEvent(new Event('change', { bubbles: true }));
          const id = trigger.querySelector('[data-field="triggerId"]');
          id.value = eventName;
          id.dispatchEvent(new Event('change', { bubbles: true }));
        }
        """,
        event_name,
    )


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        try:
            page.goto(BASE_URL, wait_until="networkidle")
            page.get_by_role("button", name="Mojo", exact=True).click()
            page.evaluate(
                """
                () => {
                  const output = document.getElementById('output-enabled');
                  output.checked = true;
                  output.dispatchEvent(new Event('change', { bubbles: true }));
                }
                """
            )
            page.locator("#output-instructions").fill(
                "Acknowledge the patient's pain and suggest contacting their therapist."
            )

            assert page.evaluate("TRIGGER_IDS.Mojo") == EXPECTED_EVENTS
            assert not page.evaluate(
                "PARAMETERS.Mojo.some(p => p.id === 'is_completed')"
            ), "is_completed was removed from the engine and must not be offered"

            offered = page.evaluate(
                """
                () => {
                  const trigger = document.getElementById('trigger-root');
                  const ds = trigger.querySelector('[data-field="dataSource"]');
                  ds.value = 'Mojo';
                  ds.dispatchEvent(new Event('change', { bubbles: true }));
                  const sel = trigger.querySelector('[data-field="triggerId"]');
                  return [...sel.options].map(o => o.value).filter(Boolean);
                }
                """
            )
            assert offered == EXPECTED_EVENTS, offered

            # app_open carries no attributes, so it fires on occurrence alone.
            select_mojo_trigger(page, "app_open")
            built = page.evaluate("buildRuleJSON()")
            assert built["triggerExpression"]["id"] == "app_open"
            assert built["triggerExpression"].get("conditions", []) == []

            # Each event offers only the parameters it actually carries.
            select_mojo_trigger(page, "exercise_skipped")
            params = page.evaluate(
                """
                () => {
                  const dl = document.querySelector('#trigger-root datalist[data-param-hints]');
                  return [...dl.options].map(o => o.value);
                }
                """
            )
            assert "reason_for_skipping" in params, params
            assert "pain_score" not in params, params
            assert "current_streak" not in params, params

            select_mojo_trigger(page, "session_abandoned")
            params = page.evaluate(
                """
                () => {
                  const dl = document.querySelector('#trigger-root datalist[data-param-hints]');
                  return [...dl.options].map(o => o.value);
                }
                """
            )
            assert "reason_for_skipping" in params, params
            assert "rom_score" not in params, params

            # The eventName selector disambiguates a parameter two events share.
            built = page.evaluate(
                """
                () => {
                  const trigger = document.getElementById('trigger-root');
                  const fields = trigger.querySelector('.conditions-list .item-fields');
                  fields.querySelector('[data-field="parameter"]').value = 'reason_for_skipping';
                  fields.querySelector('[data-field="parameter"]')
                        .dispatchEvent(new Event('change', { bubbles: true }));
                  fields.querySelector('[data-field="operator"]').value = '==';
                  fields.querySelector('[data-field="value"]').value = 'too_painful';
                  fields.querySelector('[data-field="eventName"]').value = 'session_abandoned';
                  return buildRuleJSON();
                }
                """
            )
            cond = built["triggerExpression"]["conditions"][0]
            assert cond == {
                "type": "Value",
                "parameter": "reason_for_skipping",
                "operator": "==",
                "value": "too_painful",
                "eventName": "session_abandoned",
            }, cond

            # A rule carrying eventName must pass schema validation.
            result = page.evaluate("(rule) => validateRule([rule])", built)
            assert result["errors"] == [], result["errors"]

            # A shared parameter with no eventName warns instead of resolving silently.
            ambiguous = page.evaluate(
                """
                (rule) => {
                  const copy = JSON.parse(JSON.stringify(rule));
                  delete copy.triggerExpression.conditions[0].eventName;
                  return validateRule([copy]);
                }
                """,
                built,
            )
            assert ambiguous["errors"] == [], ambiguous["errors"]
            assert any(
                "reason_for_skipping" in w and "eventName" in w
                for w in ambiguous["warnings"]
            ), ambiguous["warnings"]

            # A condition on the removed is_completed flag warns with the migration path.
            removed = page.evaluate(
                """
                (rule) => {
                  const copy = JSON.parse(JSON.stringify(rule));
                  copy.triggerExpression.conditions[0] = {
                    type: 'Value', parameter: 'is_completed', operator: '==', value: false
                  };
                  return validateRule([copy]);
                }
                """,
                built,
            )
            assert any(
                "is_completed" in w and "never match" in w for w in removed["warnings"]
            ), removed["warnings"]

            print("mojo_events_e2e: PASS")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
