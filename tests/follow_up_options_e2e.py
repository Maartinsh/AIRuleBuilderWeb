import json
import os
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("RULE_BUILDER_URL", "http://127.0.0.1:4173")

FUEL_STATIONS = {
    "id": "fuel_stations",
    "dataSource": "External Source",
    "triggerId": "google_nearby_gas_station",
    "source": "places",
    "fields": ["displayName", "formattedAddress"],
}

# The driving use case from the engine's FOLLOW_UP_CONTEXT_AND_ACTIONS.md, with the
# builder's own MZONE trigger standing in for the doc's `next_job`.
FUEL_RULE = {
    "id": "refuel_before_next_job",
    "sessionScope": "activity",
    "priority": 9,
    "throttle": {"cooldownMinutes": 60, "maxTriggersPerDay": 3},
    "output": {
        "tone": "calm and practical",
        "instructions": "Name the fuel stations nearby, then ask which one the driver wants.",
        "variables": [
            {"id": "fuel_level", "dataSource": "MHub"},
            {"id": "nextJobDistance", "dataSource": "MZONE"},
            FUEL_STATIONS,
        ],
    },
    "followUp": {
        "id": "choose_station",
        "question": "Which station should I navigate to?",
        "options": {
            "fromVariable": "fuel_stations",
            "labelFields": ["displayName.text", "formattedAddress"],
            "max": 3,
        },
    },
    "triggerExpression": {
        "type": "GROUP",
        "groupType": "AND",
        "expressions": [
            {"type": "SINGLE", "id": "mhub_fuel_level", "dataSource": "MHub",
             "conditions": [{"type": "Value", "parameter": "fuel_level", "operator": "<=", "value": 15}]},
            {"type": "SINGLE", "id": "get_todays_jobs", "dataSource": "MZONE",
             "conditions": [{"type": "Value", "parameter": "nextJobDistance", "operator": ">=", "value": 60}]},
            {"type": "SINGLE", "id": "google_nearby_gas_station", "dataSource": "External Source",
             "conditions": [{"type": "Value", "parameter": "placesFound", "operator": ">=", "value": 1}]},
        ],
    },
}


def variant(**overrides):
    rule = json.loads(json.dumps(FUEL_RULE))
    rule.update(overrides)
    return rule


def load(page, rule):
    return page.evaluate("(rule) => { populateFormFromRule(rule); return buildRuleJSON(); }", rule)


def validate(page):
    return page.evaluate("() => validateRule([buildRuleJSON()])")


def option_values(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('#follow-up-options-variable option')].map(o => o.value)"
    )


def selected_option_text(page):
    return page.evaluate(
        "() => document.getElementById('follow-up-options-variable').selectedOptions[0].textContent"
    )


def chips(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('#follow-up-options-label-chips button')].map(b => b.textContent)"
    )


def check(page, element_id, checked=True):
    page.evaluate(
        """([id, checked]) => {
          const el = document.getElementById(id);
          el.checked = checked;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        [element_id, checked],
    )


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        try:
            page.goto(BASE_URL, wait_until="networkidle")
            page.on("dialog", lambda dialog: dialog.accept())

            # Fleet is the default product and the follow-up is no longer Mojo-only.
            section = page.locator("#section-follow-up")
            section.wait_for(state="visible")

            # The fuel rule round-trips, choice options and the places list variable included.
            built = load(page, FUEL_RULE)
            assert built["followUp"] == FUEL_RULE["followUp"], built["followUp"]
            assert built["output"]["variables"][2] == FUEL_STATIONS, built["output"]["variables"]
            assert page.locator("#follow-up-options-fields").is_visible()

            # Only the list variable a trigger of this rule delivers is offered; the scalars are not.
            assert option_values(page) == ["", "fuel_stations"], option_values(page)
            assert page.locator("#follow-up-options-variable").input_value() == "fuel_stations"
            # displayName extracts as an object, so the chip names it down to its text.
            assert chips(page) == ["displayName.text", "formattedAddress"], chips(page)
            assert page.locator("#follow-up-options-labels").input_value() == "displayName.text, formattedAddress"
            assert page.locator("#follow-up-options-max").input_value() == "3"
            result = validate(page)
            assert result["errors"] == [], result["errors"]
            assert not [w for w in result["warnings"] if "ollow-up" in w], result["warnings"]

            # Removing the Google trigger un-backs the variable: it stays selected and is
            # labelled and rejected (the engine refuses such a rule), never dropped silently.
            unbacked = variant()
            unbacked["triggerExpression"]["expressions"].pop()
            built = load(page, unbacked)
            assert built["followUp"]["options"]["fromVariable"] == "fuel_stations"
            assert option_values(page) == ["", "fuel_stations"]
            assert "not read by any trigger" in selected_option_text(page), selected_option_text(page)
            result = validate(page)
            assert any("would never fire" in e for e in result["errors"]), result["errors"]
            assert not [w for w in result["warnings"] if "ollow-up" in w], result["warnings"]
            # The engine picks a list variable's response by its trigger id; the builder always
            # exports one for a list variable, so the shared-data-source ambiguity cannot be authored here.
            assert built["output"]["variables"][2]["triggerId"] == "google_nearby_gas_station"

            # The candidate rule itself: an explicit triggerId must be one of the rule's
            # triggers; without one, any trigger with the variable's data source backs it.
            candidates = page.evaluate(
                """() => followUpOptionCandidates({
                  output: { variables: [
                    { id: 'scalar', dataSource: 'MZONE' },
                    { id: 'jobs', dataSource: 'MZONE', source: 'jobs', fields: ['description'] },
                    { id: 'cafes', dataSource: 'External Source', triggerId: 'google_nearby_cafe', source: 'places', fields: ['displayName'] },
                    { id: 'stations', dataSource: 'External Source', triggerId: 'google_nearby_gas_station', source: 'places', fields: ['displayName'] }
                  ] },
                  triggerExpression: { type: 'GROUP', groupType: 'AND', expressions: [
                    { type: 'SINGLE', id: 'get_todays_jobs', dataSource: 'MZONE' },
                    { type: 'GROUP', groupType: 'OR', expressions: [
                      { type: 'SINGLE', id: 'google_nearby_gas_station', dataSource: 'External Source' }
                    ] }
                  ] }
                }).map(c => [c.id, c.backed])"""
            )
            assert candidates == [["jobs", True], ["cafes", False], ["stations", True]], candidates

            # Authoring from scratch: nothing to offer until a backed list variable exists,
            # and validation blocks publishing an empty choice.
            page.evaluate("resetForm(true)")
            check(page, "output-enabled")
            page.locator("#output-instructions").fill("Ask which one.")
            check(page, "follow-up-enabled")
            check(page, "follow-up-options-enabled")
            page.locator("#follow-up-question").fill("Which one?")
            assert option_values(page) == [""], option_values(page)
            assert "No list variable" in selected_option_text(page)
            result = validate(page)
            assert any("need a variable to list" in e for e in result["errors"]), result["errors"]
            assert any("at least one label field" in e for e in result["errors"]), result["errors"]

            # A rule whose only trigger is an on-device event has nothing to list, and the hint
            # says so; one with a places trigger but no list variable names what to add.
            accel = {
                "id": "harsh_acceleration",
                "sessionScope": "global",
                "output": {"instructions": "Coach gently."},
                "followUp": {"id": "confirmation", "question": "Want a tip?", "options": {"fromVariable": "", "labelFields": []}},
                "triggerExpression": {
                    "type": "SINGLE", "id": "driving_behaviour_event_acceleration", "dataSource": "SmartDrive",
                    "conditions": [{"type": "EventCount", "eventName": "driving_behaviour_event_acceleration", "operator": ">=", "value": 3}],
                },
            }
            load(page, accel)
            assert option_values(page) == [""], option_values(page)
            hint = page.locator("#follow-up-options-variable-hint").text_content()
            assert "driving_behaviour_event_acceleration delivers single values" in hint, hint
            no_var = variant()
            no_var["output"]["variables"] = [v for v in no_var["output"]["variables"] if v["id"] != "fuel_stations"]
            load(page, no_var)
            hint = page.locator("#follow-up-options-variable-hint").text_content()
            assert "google_nearby_gas_station returns a places list" in hint and "Source Key places" in hint, hint

            # With the fuel rule's variables and triggers in place, turning on the choice and
            # picking the variable pre-fills the labels; chips edit the list in place.
            built = load(page, variant(followUp={"id": "choose_station", "question": "Which station?"}))
            assert "options" not in built["followUp"]
            check(page, "follow-up-options-enabled")
            page.select_option("#follow-up-options-variable", "fuel_stations")
            assert page.locator("#follow-up-options-labels").input_value() == "displayName.text, formattedAddress"
            page.locator("#follow-up-options-label-chips button", has_text="formattedAddress").click()
            assert page.locator("#follow-up-options-labels").input_value() == "displayName.text"
            built = page.evaluate("buildRuleJSON()")
            assert built["followUp"]["options"] == {"fromVariable": "fuel_stations", "labelFields": ["displayName.text"]}, built["followUp"]
            page.locator("#follow-up-options-max").fill("0")
            result = validate(page)
            assert any("at least 1" in e for e in result["errors"]), result["errors"]
            page.locator("#follow-up-options-max").fill("2")
            assert page.evaluate("buildRuleJSON().followUp.options.max") == 2

            # Label paths outside the variable's fields keep their order through import and only warn.
            odd = variant()
            odd["followUp"]["options"]["labelFields"] = ["rating", "displayName.text"]
            built = load(page, odd)
            assert built["followUp"]["options"]["labelFields"] == ["rating", "displayName.text"]
            result = validate(page)
            assert result["errors"] == [], result["errors"]
            assert any('"rating"' in w and "not among" in w for w in result["warnings"]), result["warnings"]

            # Reset clears the choice; the default follow-up id follows the product.
            page.evaluate("resetForm(true)")
            assert not page.locator("#follow-up-options-enabled").is_checked()
            assert page.locator("#follow-up-options-labels").input_value() == ""
            assert page.locator("#follow-up-id").input_value() == "confirmation"
            page.get_by_role("button", name="Mojo", exact=True).click()
            section.wait_for(state="visible")
            assert page.locator("#follow-up-id").input_value() == "exercise_confirmation"

            if screenshot_path := os.environ.get("FOLLOW_UP_OPTIONS_SCREENSHOT"):
                page.get_by_role("button", name="Fleet", exact=True).click()
                load(page, FUEL_RULE)
                section.screenshot(path=screenshot_path)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
