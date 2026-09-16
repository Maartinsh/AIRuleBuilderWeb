import json
import os
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("RULE_BUILDER_URL", "http://127.0.0.1:4173")

CATEGORIES = [
    "Cafe", "Restaurant", "FastFood", "FuelStation", "ChargingStation",
    "Parking", "CarRepair", "CarWash", "Hospital", "Pharmacy",
    "Police", "Bank", "Atm", "Supermarket", "Hotel",
]

# The rule as it is deployed on the MZone server today, in the retired Google
# grammar. The engine still serves it, so the builder must still read it.
DEPLOYED_LEGACY_RULE = {
    "id": "fuel_stop_en_route",
    "sessionScope": "activity",
    "priority": 8,
    "throttle": {"cooldownMinutes": 30, "maxTriggersPerDay": 5},
    "output": {
        "instructions": "Name the fuel stations on the route, then ask which one.",
        "tone": "calm and practical",
        "variables": [
            {"dataSource": "SmartDrive", "id": "speed"},
            {"dataSource": "MZONE", "id": "nextJobDistance"},
            {"dataSource": "External Source", "id": "places",
             "triggerId": "google_nearby_gas_station", "source": "places",
             "fields": ["displayName", "formattedAddress", "distanceLabel"]},
        ],
    },
    "followUp": {
        "id": "choose_fuel_stop",
        "question": "Which station should I navigate to?",
        "options": {"fromVariable": "places",
                    "labelFields": ["displayName.text", "distanceLabel"], "max": 3},
    },
    "triggerExpression": {"type": "GROUP", "groupType": "AND", "expressions": [
        {"type": "SINGLE", "id": "trip_speed", "dataSource": "SmartDrive",
         "conditions": [{"type": "Value", "parameter": "speed", "operator": ">=", "value": 50}]},
        {"type": "SINGLE", "id": "get_remaining_jobs", "dataSource": "MZONE",
         "conditions": [{"type": "Value", "parameter": "count", "operator": ">=", "value": 1}]},
        {"type": "SINGLE", "id": "google_nearby_gas_station", "dataSource": "External Source",
         "conditions": [{"type": "Value", "parameter": "placesFound", "operator": ">", "value": 1}],
         "search": {"mode": "along_route",
                    "destination": {"triggerId": "get_remaining_jobs",
                                    "latField": "nextJobLat", "lngField": "nextJobLng"},
                    "radius": 30000, "maxDetourMeters": 3000}},
    ]},
}


def places_rule(expr_id, dataSource="MZONE", search=None, conditions=None):
    single = {"type": "SINGLE", "id": expr_id, "dataSource": dataSource,
              "conditions": conditions if conditions is not None
              else [{"type": "Value", "parameter": "placesFound", "operator": ">=", "value": 1}]}
    if search is not None:
        single["search"] = search
    return {"id": "r", "sessionScope": "activity", "output": {"instructions": "x"},
            "triggerExpression": single}


def load(page, rule):
    return page.evaluate("(rule) => { populateFormFromRule(rule); return buildRuleJSON(); }", rule)


def validate(page, rule=None):
    script = "() => validateRule([buildRuleJSON()])" if rule is None else "(rule) => validateRule([rule])"
    result = page.evaluate(script, rule) if rule is not None else page.evaluate(script)
    # Every search rule needs schema 1.2.0; while that schema is unreleased the
    # release-gate warning is on all of them. schema_version_e2e.py asserts it appears.
    result["warnings"] = [w for w in result["warnings"] if "reject the whole document" not in w]
    return result


def endpoint_options(page, index=0):
    return page.evaluate(
        """(index) => {
          const box = document.querySelectorAll('[data-field="singleTrigger"]')[index];
          const el = box.querySelector('[data-field="triggerId"]');
          if (el.tagName !== 'SELECT') return null;
          return [...el.options].map(o => o.value);
        }""",
        index,
    )


def set_trigger(page, field, value, index=0):
    page.evaluate(
        """([index, field, value]) => {
          const box = document.querySelectorAll('[data-field="singleTrigger"]')[index];
          const el = box.querySelector(`[data-field="${field}"]`);
          el.value = value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        [index, field, value],
    )


def query_visible(page, index=0):
    return page.evaluate(
        """(index) => {
          const box = document.querySelectorAll('[data-field="search-container"]')[index];
          return !box.querySelector('[data-field="search-query-field"]').classList.contains('hidden');
        }""",
        index,
    )


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        try:
            page.goto(BASE_URL, wait_until="networkidle")
            page.on("dialog", lambda dialog: dialog.accept())

            # ── The fifteen categories are MZONE's, and External Source has none ──
            page.evaluate("resetForm(true)")
            set_trigger(page, "dataSource", "MZONE")
            offered = endpoint_options(page)
            for category in CATEGORIES:
                assert f"nearby_{category}" in offered, (category, offered)
            assert "__nearby_custom__" in offered, offered

            set_trigger(page, "dataSource", "External Source")
            offered = endpoint_options(page)
            assert not [o for o in offered if "nearby" in o], offered

            # ── A category search round-trips, and asks for no query ──
            fuel = places_rule("nearby_FuelStation", search={"mode": "nearby", "radius": 5000, "limit": 3})
            built = load(page, fuel)
            assert built["triggerExpression"]["search"] == {
                "mode": "nearby", "radius": 5000, "limit": 3,
            }, built["triggerExpression"]["search"]
            assert validate(page)["errors"] == [], validate(page)["errors"]
            assert validate(page)["warnings"] == [], validate(page)["warnings"]
            assert not query_visible(page), "a category names the subject; a query would narrow it"

            # limit is part of the search's identity, so it is validated like radius.
            errors = validate(page, places_rule("nearby_Cafe", search={"mode": "nearby", "limit": 0}))["errors"]
            assert any("search.limit must be an integer of at least 1 - got 0" in e for e in errors), errors
            errors = validate(page, places_rule("nearby_Cafe", search={"mode": "nearby", "limit": "5"}))["errors"]
            assert any('search.limit must be an integer of at least 1 (a quoted number is a string) - got "5"' in e
                       for e in errors), errors

            # A query on a category is the one mistake the engine will not take.
            errors = validate(page, places_rule(
                "nearby_FuelStation", search={"mode": "nearby", "query": "diesel"}))["errors"]
            assert any("search.query is not allowed on 'nearby_FuelStation'" in e for e in errors), errors

            # ── Free text: the suffix is a label, and it must say what to look for ──
            free = places_rule("nearby_truck_stop", search={"mode": "nearby", "query": "truck stop with showers"})
            built = load(page, free)
            assert built["triggerExpression"]["id"] == "nearby_truck_stop", built["triggerExpression"]
            assert built["triggerExpression"]["search"]["query"] == "truck stop with showers", built
            assert query_visible(page), "a free-text label has to declare its query"
            assert validate(page)["errors"] == [], validate(page)["errors"]

            errors = validate(page, places_rule("nearby_truck_stop", search={"mode": "nearby"}))["errors"]
            assert any("search.query is required on 'nearby_truck_stop'" in e for e in errors), errors
            errors = validate(page, places_rule(
                "nearby_truck_stop", search={"mode": "nearby", "query": "   "}))["errors"]
            assert any("search.query must be a non-blank string" in e for e in errors), errors

            # A misspelt category is a free-text label, and is told which spelling it wanted.
            errors = validate(page, places_rule("nearby_fuel_station", search={"mode": "nearby"}))["errors"]
            assert any("did you mean 'nearby_FuelStation'?" in e for e in errors), errors

            # A bare prefix has no subject at all.
            errors = validate(page, places_rule("nearby_", search={"mode": "nearby"}))["errors"]
            assert any("has nothing after 'nearby_', so the search has no subject" in e for e in errors), errors

            # Picking the custom endpoint swaps the dropdown for the field the id is typed in.
            page.evaluate("resetForm(true)")
            set_trigger(page, "dataSource", "MZONE")
            set_trigger(page, "triggerId", "__nearby_custom__")
            assert endpoint_options(page) is None, "custom search must be typed, not picked"
            set_trigger(page, "triggerId", "nearby_truck_stop")
            assert query_visible(page), query_visible(page)
            assert page.evaluate("() => buildRuleJSON().triggerExpression.id") == "nearby_truck_stop"

            # ── The deployed Google rule still reads, unchanged, with one warning ──
            built = load(page, DEPLOYED_LEGACY_RULE)
            assert built["triggerExpression"] == DEPLOYED_LEGACY_RULE["triggerExpression"], built["triggerExpression"]
            assert built["output"]["variables"] == DEPLOYED_LEGACY_RULE["output"]["variables"], built["output"]["variables"]
            assert built["followUp"] == DEPLOYED_LEGACY_RULE["followUp"], built["followUp"]
            result = validate(page)
            assert result["errors"] == [], result["errors"]
            assert len(result["warnings"]) == 1, result["warnings"]
            assert ("'google_nearby_gas_station' is deprecated; the replacement is id "
                    "'nearby_FuelStation' on dataSource 'MZONE'") in result["warnings"][0], result["warnings"]

            # A Google type with no category is an error, not a prefix discovery.
            errors = validate(page, places_rule(
                "google_nearby_zoo", dataSource="External Source", search={"mode": "nearby"}))["errors"]
            assert any("names nothing the engine can ask for" in e for e in errors), errors

            # nearby_* counts only on MZONE, google_nearby_* only on External Source, so an id
            # that collides with another source's stream is never read as a search.
            errors = validate(page, places_rule(
                "nearby_FuelStation", dataSource="External Source", search={"mode": "nearby"}))["errors"]
            assert any("is only supported on a places expression" in e for e in errors), errors

            print("nearby_places_e2e: all assertions passed")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
