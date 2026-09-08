import json
import os
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("RULE_BUILDER_URL", "http://127.0.0.1:4173")

# The canonical block from the engine's JSON_RULE_STRUCTURE.md "search" section.
COFFEE_SEARCH = {
    "mode": "along_route",
    "destination": {
        "triggerId": "get_remaining_jobs",
        "latField": "nextJobLat",
        "lngField": "nextJobLng",
    },
    "radius": 20000,
    "maxDetourMeters": 2000,
}

COFFEE_RULE = {
    "id": "coffee_along_route",
    "sessionScope": "activity",
    "output": {"instructions": "Suggest a coffee stop on the way to the next job."},
    "triggerExpression": {
        "type": "GROUP",
        "groupType": "AND",
        "expressions": [
            {"type": "SINGLE", "id": "get_remaining_jobs", "dataSource": "MZONE",
             "conditions": [{"type": "Value", "parameter": "count", "operator": ">=", "value": 1}]},
            {"type": "SINGLE", "id": "google_nearby_coffee_shop", "dataSource": "External Source",
             "conditions": [{"type": "Value", "parameter": "placesFound", "operator": ">=", "value": 1}],
             "search": COFFEE_SEARCH},
        ],
    },
}


def rule_with(search=None, **overrides):
    single = {
        "type": "SINGLE", "id": "google_nearby_coffee_shop", "dataSource": "External Source",
        "conditions": [{"type": "Value", "parameter": "placesFound", "operator": ">=", "value": 1}],
    }
    if search is not None:
        single["search"] = search
    single.update(overrides)
    return {
        "id": "r", "sessionScope": "activity", "output": {"instructions": "x"},
        "triggerExpression": {"type": "GROUP", "groupType": "AND", "expressions": [
            {"type": "SINGLE", "id": "get_remaining_jobs", "dataSource": "MZONE",
             "conditions": [{"type": "Value", "parameter": "count", "operator": ">=", "value": 1}]},
            single,
        ]},
    }


def single_rule(**expression):
    expression.setdefault("type", "SINGLE")
    return {"id": "r", "sessionScope": "activity", "output": {"instructions": "x"},
            "triggerExpression": expression}


def load(page, rule):
    return page.evaluate("(rule) => { populateFormFromRule(rule); return buildRuleJSON(); }", rule)


def validate(page, rule=None):
    if rule is None:
        return page.evaluate("() => validateRule([buildRuleJSON()])")
    return page.evaluate("(rule) => validateRule([rule])", rule)


def search_state(page, index=0):
    return page.evaluate(
        """(index) => {
          const box = document.querySelectorAll('[data-field="search-container"]')[index];
          const shown = f => !box.querySelector(`[data-field="${f}"]`).classList.contains('hidden');
          return {
            visible: !box.classList.contains('hidden'),
            destination: shown('search-destination-row'),
            destinationFields: shown('search-destination-fields'),
            detour: shown('search-detour-field'),
            point: shown('search-point-row'),
            options: [...box.querySelectorAll('[data-field="search-destination"] option')].map(o => [o.value, o.textContent]),
            selected: box.querySelector('[data-field="search-destination"]').value,
            help: box.querySelector('[data-field="search-mode-help"]').textContent,
            destinationHint: box.querySelector('[data-field="search-destination-hint"]').textContent,
          };
        }""",
        index,
    )


def pick_mode(page, mode, index=0):
    return page.evaluate(
        """([index, mode]) => {
          const box = document.querySelectorAll('[data-field="search-container"]')[index];
          const radio = box.querySelector(`[data-field="search-mode"][value="${mode}"]`);
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
          return buildRuleJSON();
        }""",
        [index, mode],
    )


def fill(page, field, value, index=0):
    page.evaluate(
        """([index, field, value]) => {
          const box = document.querySelectorAll('[data-field="search-container"]')[index];
          const el = box.querySelector(`[data-field="${field}"]`);
          el.value = value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        [index, field, value],
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


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        try:
            page.goto(BASE_URL, wait_until="networkidle")
            page.on("dialog", lambda dialog: dialog.accept())
            assert page.evaluate("() => !!schemaValidator"), "schema validator did not load"

            # The doc's canonical along_route block round-trips unchanged and passes.
            built = load(page, COFFEE_RULE)
            assert built["triggerExpression"] == COFFEE_RULE["triggerExpression"], built["triggerExpression"]
            result = validate(page)
            assert result["errors"] == [], result["errors"]
            assert result["warnings"] == [], result["warnings"]

            state = search_state(page, 1)
            assert state["visible"] and state["destination"] and state["detour"], state
            assert not state["point"], state
            assert state["selected"] == "get_remaining_jobs", state
            # The destination may not be the expression itself, so only the other trigger is offered.
            assert state["options"] == [
                ["", "— Select destination trigger —"],
                ["get_remaining_jobs", "get_remaining_jobs — Trigger #1"],
            ], state["options"]
            assert "max detour bounds the extra driving" in state["help"], state["help"]

            # The mode owns which anchors exist: a field forbidden by the active mode is
            # never emitted, so the schema's "not" branches are unreachable from the form.
            for mode in ["near_destination", "near_point", "nearby"]:
                built = pick_mode(page, mode, 1)
                search = built["triggerExpression"]["expressions"][1]["search"]
                state = search_state(page, 1)
                assert search["mode"] == mode, search
                assert ("destination" in search) == (mode == "near_destination"), search
                assert ("maxDetourMeters" in search) == (mode == "along_route"), search
                assert state["point"] == (mode == "near_point"), state
                assert state["detour"] == (mode == "along_route"), state

            # A fixed point is authored in its own fields; the deprecated POI block, which
            # the engine parses and then reads nowhere, is never written again.
            built = load(page, rule_with({"mode": "near_point", "point": {"lat": 1.0, "lng": 2.0}}))
            pick_mode(page, "near_point", 1)
            fill(page, "search-point-lat", "56.9496", 1)
            fill(page, "search-point-lng", "24.1052", 1)
            fill(page, "search-radius", "750", 1)
            built = page.evaluate("() => buildRuleJSON()")
            assert built["triggerExpression"]["expressions"][1]["search"] == {
                "mode": "near_point", "point": {"lat": 56.9496, "lng": 24.1052}, "radius": 750,
            }, built["triggerExpression"]["expressions"][1]["search"]
            assert "POI" not in built["triggerExpression"]["expressions"][1]
            assert validate(page)["errors"] == [], validate(page)["errors"]

            # LocationSearchPlanner only freshness-gates expressions that declare a block, so
            # a places trigger without one always gets the explicit nearby default.
            built = load(page, single_rule(id="google_nearby_gas_station", dataSource="External Source",
                                           conditions=[{"type": "Value", "parameter": "placesFound", "operator": ">=", "value": 1}]))
            assert built["triggerExpression"]["search"] == {"mode": "nearby"}, built["triggerExpression"]

            # Authoring from scratch: the form belongs to the trigger id, not the data source.
            page.evaluate("resetForm(true)")
            set_trigger(page, "dataSource", "External Source")
            assert not search_state(page)["visible"]
            set_trigger(page, "triggerId", "google_nearby_cafe")
            assert search_state(page)["visible"]
            assert page.evaluate("() => buildRuleJSON().triggerExpression.search") == {"mode": "nearby"}
            set_trigger(page, "triggerId", "weather_forecast")
            assert not search_state(page)["visible"]
            assert page.evaluate("() => buildRuleJSON().triggerExpression.search") is None

            # An imported block, though, is kept when the trigger stops being a places one,
            # so the endpoint mismatch is reported instead of quietly disappearing.
            load(page, single_rule(id="google_nearby_cafe", dataSource="External Source",
                                   search={"mode": "nearby", "radius": 300}))
            set_trigger(page, "triggerId", "weather_forecast")
            built = page.evaluate("() => buildRuleJSON()")
            assert built["triggerExpression"]["search"] == {"mode": "nearby", "radius": 300}
            assert any(
                "is only supported on google_nearby_* expressions of External Source" in e
                for e in validate(page)["errors"]
            ), validate(page)["errors"]

            # Destination candidates: never the expression itself, never an expression
            # carrying a search of its own - a destination cannot be read from another
            # search - and never one whose response has no coordinates to read.
            two = {"id": "two", "sessionScope": "activity", "output": {"instructions": "x"},
                   "triggerExpression": {"type": "GROUP", "groupType": "AND", "expressions": [
                       {"type": "SINGLE", "id": "google_nearby_cafe", "dataSource": "External Source",
                        "search": {"mode": "nearby"}},
                       {"type": "SINGLE", "id": "google_nearby_atm", "dataSource": "External Source",
                        "search": {"mode": "near_destination", "destination": {
                            "triggerId": "get_todays_jobs", "latField": "nextJobLat", "lngField": "nextJobLng"}}},
                       {"type": "SINGLE", "id": "get_todays_jobs", "dataSource": "MZONE",
                        "conditions": [{"type": "Value", "parameter": "count", "operator": ">=", "value": 1}]},
                       {"type": "SINGLE", "id": "get_trips", "dataSource": "MZONE",
                        "conditions": [{"type": "Value", "parameter": "count", "operator": ">=", "value": 1}]},
                       {"type": "SINGLE", "id": "mhub_speed", "dataSource": "MHub",
                        "conditions": [{"type": "Value", "parameter": "speed", "operator": ">=", "value": 1}]},
                   ]}}
            load(page, two)
            assert [v for v, _ in search_state(page, 0)["options"]] == ["", "get_todays_jobs"]
            assert [v for v, _ in search_state(page, 1)["options"]] == ["", "get_todays_jobs"]

            # Picking a jobs trigger fills in the coordinate fields that endpoint returns.
            fill(page, "search-destination", "get_todays_jobs", 1)
            assert page.evaluate("() => buildRuleJSON().triggerExpression.expressions[1].search")["destination"] == {
                "triggerId": "get_todays_jobs",
                "latField": "nextJobLat", "lngField": "nextJobLng",
            }
            assert validate(page)["warnings"] == [], validate(page)["warnings"]

            # JOB_DETAILS renames the job's coordinates on the way in, so switching to it
            # replaces the pair the builder suggested for the previous trigger.
            jobs_and_details = rule_with(
                {"mode": "near_destination", "destination": {
                    "triggerId": "get_remaining_jobs",
                    "latField": "nextJobLat", "lngField": "nextJobLng"}})
            jobs_and_details["triggerExpression"]["expressions"].insert(
                1, {"type": "SINGLE", "id": "job_details", "dataSource": "MZONE",
                    "conditions": [{"type": "Value", "parameter": "isProblematic", "operator": "==", "value": True}]})
            load(page, jobs_and_details)
            fill(page, "search-destination", "job_details", 2)
            assert page.evaluate("() => buildRuleJSON().triggerExpression.expressions[2].search")["destination"] == {
                "triggerId": "job_details", "latField": "lat", "lngField": "lng",
            }
            # A hand-typed field name is the author's business and survives the switch.
            fill(page, "search-dest-lat-field", "customLat", 2)
            fill(page, "search-destination", "get_remaining_jobs", 2)
            dest = page.evaluate("() => buildRuleJSON().triggerExpression.expressions[2].search")["destination"]
            assert dest["latField"] == "customLat" and dest["lngField"] == "nextJobLng", dest
            assert any("reads 'customLat' / 'nextJobLng' from 'get_remaining_jobs', which returns "
                       "'nextJobLat' / 'nextJobLng'" in w for w in validate(page)["warnings"]), validate(page)["warnings"]

            # An imported destination on a trigger that returns no coordinates is kept and
            # labelled; the engine cannot see the field catalogue, so the builder warns.
            no_coords = rule_with({"mode": "near_destination", "destination": {
                "triggerId": "get_trips", "latField": "lat", "lngField": "lng"}})
            no_coords["triggerExpression"]["expressions"][0] = {
                "type": "SINGLE", "id": "get_trips", "dataSource": "MZONE",
                "conditions": [{"type": "Value", "parameter": "count", "operator": ">=", "value": 1}]}
            load(page, no_coords)
            state = search_state(page, 1)
            assert state["selected"] == "get_trips", state
            assert ["get_trips", "get_trips — delivers no destination coordinates"] in state["options"], state["options"]
            assert validate(page)["errors"] == [], validate(page)["errors"]
            assert any("'get_trips' returns no coordinates, so the destination could never resolve "
                       "and the rule would never fire" in w for w in validate(page)["warnings"]), validate(page)["warnings"]

            # An endpoint the builder does not know is offered and never second-guessed.
            unknown = rule_with({"mode": "near_destination", "destination": {
                "triggerId": "custom_endpoint", "latField": "a", "lngField": "b"}})
            unknown["triggerExpression"]["expressions"][0] = {
                "type": "SINGLE", "id": "custom_endpoint", "dataSource": "MZONE"}
            load(page, unknown)
            assert [v for v, _ in search_state(page, 1)["options"]] == ["", "custom_endpoint"]
            assert validate(page)["warnings"] == [], validate(page)["warnings"]

            # Schema 1.2.0 dropped destination.source before it shipped, so an import strips
            # the key rather than translating it, and a document that keeps it is rejected.
            stale = rule_with({"mode": "near_destination", "destination": {
                "source": "trigger", "triggerId": "get_remaining_jobs",
                "latField": "nextJobLat", "lngField": "nextJobLng"}})
            assert any("search.destination.source is not supported" in e
                       for e in validate(page, stale)["errors"]), validate(page, stale)["errors"]
            migrated = page.evaluate("(r) => migrateRule(JSON.parse(JSON.stringify(r)))", stale)
            assert migrated["triggerExpression"]["expressions"][1]["search"]["destination"] == {
                "triggerId": "get_remaining_jobs", "latField": "nextJobLat", "lngField": "nextJobLng",
            }, migrated["triggerExpression"]["expressions"][1]["search"]
            assert validate(page, migrated)["errors"] == [], validate(page, migrated)["errors"]

            # An app-supplied destination has no expression left, so the migration cannot invent
            # one: the key goes and the three now-unconditional fields are reported missing.
            app_dest = rule_with({"mode": "near_destination", "destination": {"source": "app"}})
            migrated = page.evaluate("(r) => migrateRule(JSON.parse(JSON.stringify(r)))", app_dest)
            assert migrated["triggerExpression"]["expressions"][1]["search"]["destination"] == {}
            errors = validate(page, migrated)["errors"]
            for field in ["triggerId", "latField", "lngField"]:
                assert any(f"search.destination.{field} must be a non-blank string" in e
                           for e in errors), (field, errors)

            # Authoring one from scratch: the form emits no destination until a trigger is named,
            # so a blank one reports the required destination rather than three empty fields.
            load(page, rule_with({"mode": "nearby"}))
            pick_mode(page, "near_destination", 1)
            assert "destination" not in page.evaluate(
                "() => buildRuleJSON().triggerExpression.expressions[1].search")
            assert any("search.destination is required for mode 'near_destination'" in e
                       for e in validate(page)["errors"]), validate(page)["errors"]
            fill(page, "search-destination", "get_remaining_jobs", 1)
            assert page.evaluate("() => buildRuleJSON().triggerExpression.expressions[1].search")["destination"] == {
                "triggerId": "get_remaining_jobs", "latField": "nextJobLat", "lngField": "nextJobLng",
            }
            assert validate(page)["errors"] == [], validate(page)["errors"]

            # A destination that stops being offered is kept and labelled, never dropped.
            load(page, rule_with({"mode": "near_destination", "destination": {
                "triggerId": "gone", "latField": "a", "lngField": "b"}}))
            state = search_state(page, 1)
            assert state["selected"] == "gone", state
            assert ["gone", "gone — not a trigger of this rule"] in state["options"], state["options"]
            assert any("would never fire" in e for e in validate(page)["errors"]), validate(page)["errors"]

            # RuleMapper.liftLegacyRadius on import: the largest legacy radius fills in an
            # absent search.radius and every legacy condition goes away.
            legacy = single_rule(id="google_nearby_gas_station", dataSource="External Source", conditions=[
                {"type": "Value", "parameter": "radius", "operator": "==", "value": "800"},
                {"type": "Value", "parameter": "radius", "operator": "==", "value": "1500"},
                {"type": "Value", "parameter": "placesFound", "operator": ">=", "value": 1},
            ])
            migrated = page.evaluate("(r) => migrateRule(JSON.parse(JSON.stringify(r)))", legacy)
            assert migrated["triggerExpression"]["search"] == {"mode": "nearby", "radius": 1500}, migrated
            assert migrated["triggerExpression"]["conditions"] == [
                {"type": "Value", "parameter": "placesFound", "operator": ">=", "value": 1}], migrated

            # A declared radius wins over the legacy one, which still goes away.
            declared = json.loads(json.dumps(legacy))
            declared["triggerExpression"]["search"] = {"mode": "nearby", "radius": 400}
            migrated = page.evaluate("(r) => migrateRule(JSON.parse(JSON.stringify(r)))", declared)
            assert migrated["triggerExpression"]["search"] == {"mode": "nearby", "radius": 400}, migrated
            assert len(migrated["triggerExpression"]["conditions"]) == 1, migrated

            # An unparseable one is left in place so it is reported rather than discarded.
            broken = json.loads(json.dumps(legacy))
            broken["triggerExpression"]["conditions"][0]["value"] = "3 km"
            migrated = page.evaluate("(r) => migrateRule(JSON.parse(JSON.stringify(r)))", broken)
            assert "search" not in migrated["triggerExpression"], migrated
            assert len(migrated["triggerExpression"]["conditions"]) == 3, migrated
            errors = validate(page, broken)["errors"]
            assert any('legacy radius must be a positive integer - got "3 km"' in e for e in errors), errors
            warnings = validate(page, legacy)["warnings"]
            assert any("is superseded by search.radius" in w for w in warnings), warnings

            # Variables and destination references resolve a trigger id once per rule.
            duplicate = rule_with({"mode": "nearby"})
            duplicate["triggerExpression"]["expressions"].append({
                "type": "SINGLE", "id": "google_nearby_coffee_shop", "dataSource": "External Source",
                "search": {"mode": "near_point", "point": {"lat": 1, "lng": 2}}})
            errors = validate(page, duplicate)["errors"]
            assert any("require one search per trigger id within a rule" in e for e in errors), errors

            # A field forbidden by the mode fails a schema "not", which Ajv can only report as
            # "must NOT be valid" - the mirrored validator names the field instead.
            forbidden = {
                "maxDetourMeters is only allowed for mode 'along_route'": {"mode": "nearby", "maxDetourMeters": 2000},
                "destination is not allowed for mode 'nearby'": {"mode": "nearby", "destination": {"triggerId": "get_remaining_jobs", "latField": "nextJobLat", "lngField": "nextJobLng"}},
                "destination is not allowed for mode 'near_point'": {
                    "mode": "near_point", "point": {"lat": 1, "lng": 2}, "destination": {"triggerId": "get_remaining_jobs", "latField": "nextJobLat", "lngField": "nextJobLng"}},
            }
            for expected, search in forbidden.items():
                errors = validate(page, rule_with(search))["errors"]
                assert any(expected in e for e in errors), (expected, errors)
                assert not [e for e in errors if "must NOT be valid" in e], errors
                assert not [e for e in errors if 'must match "then" schema' in e], errors

            # Wording that has to match the engine's, so the panel says what CI will.
            wording = {
                "along_route no detour": (
                    {"mode": "along_route", "destination": {"triggerId": "get_remaining_jobs", "latField": "nextJobLat", "lngField": "nextJobLng"}},
                    "search.maxDetourMeters is required for mode 'along_route'"),
                "unknown mode": (
                    {"mode": "walking"},
                    "search.mode 'walking' is not one of nearby, along_route, near_destination, near_point. "
                    "An unknown mode is never read as a nearby search"),
                "missing mode": (
                    {"radius": 500},
                    "search.mode is required and must be one of nearby, along_route, near_destination, near_point"),
                "quoted radius": (
                    {"mode": "nearby", "radius": "500"},
                    'search.radius must be an integer of at least 1 (a quoted number is a string) - got "500"'),
                "zero radius": (
                    {"mode": "nearby", "radius": 0},
                    "search.radius must be an integer of at least 1 - got 0"),
                "stray field": (
                    {"mode": "nearby", "wat": 1},
                    "search.wat is not supported"),
                "blank latField": (
                    {"mode": "near_destination", "destination": {
                        "triggerId": "get_remaining_jobs", "latField": "  ", "lngField": "nextJobLng"}},
                    "search.destination.latField must be a non-blank string"),
                "self destination": (
                    {"mode": "near_destination", "destination": {
                        "triggerId": "google_nearby_coffee_shop", "latField": "a", "lngField": "b"}},
                    "'google_nearby_coffee_shop' is the expression itself; the destination must be read from "
                    "another trigger of the rule"),
                "point out of range": (
                    {"mode": "near_point", "point": {"lat": 991, "lng": 2}},
                    "search.point.lat must be between -90 and 90 - got 991"),
                "point missing lng": (
                    {"mode": "near_point", "point": {"lat": 56.9}},
                    "search.point.lng must be a number - got nothing"),
            }
            for label, (search, expected) in wording.items():
                errors = validate(page, rule_with(search))["errors"]
                assert any(expected in e for e in errors), (label, errors)

            # A destination cannot be read from another search, so no chains and no cycles.
            chained = rule_with({"mode": "near_destination", "destination": {
                "triggerId": "google_nearby_cafe", "latField": "a", "lngField": "b"}})
            chained["triggerExpression"]["expressions"].append({
                "type": "SINGLE", "id": "google_nearby_cafe", "dataSource": "External Source",
                "search": {"mode": "nearby"}})
            errors = validate(page, chained)["errors"]
            assert any("has a search block of its own; a destination cannot be read from another search" in e
                       for e in errors), errors

            # POI is parsed and read nowhere, on any trigger, so every block draws the warning -
            # but only a places expression can be told to use search.point instead, since search
            # is an error anywhere else.
            poi_block = {"coordinates": {"lat": 56.92125, "lng": 24.00128}, "radius": "1000"}
            warnings = validate(page, single_rule(
                id="poi_entry", dataSource="POI", POI=poi_block))["warnings"]
            assert any("POI is read nowhere and can be removed; search is accepted only on "
                       "google_nearby_* expressions of External Source, so there is nothing to "
                       "move it to here" in w for w in warnings), warnings
            warnings = validate(page, single_rule(
                id="google_nearby_cafe", dataSource="External Source", POI=poi_block,
                search={"mode": "nearby"}))["warnings"]
            assert any('POI is read nowhere; a fixed anchor is search.point with "mode": "near_point"' in w
                       for w in warnings), warnings

            # A declared null is the same as an absent key to the engine, so neither the
            # endpoint check nor the POI warning fires on one.
            nulls = single_rule(id="get_todays_jobs", dataSource="MZONE", search=None, POI=None,
                                conditions=[{"type": "Value", "parameter": "count", "operator": ">=", "value": 1}])
            result = validate(page, nulls)
            assert not [e for e in result["errors"] if "only supported on" in e], result["errors"]
            assert not [w for w in result["warnings"] if "POI" in w], result["warnings"]

            # The inputs the engine would reject are the ones that get marked.
            load(page, rule_with({"mode": "along_route", "destination": {
                "triggerId": "get_remaining_jobs", "latField": "", "lngField": "nextJobLng"}}))
            marked = page.evaluate(
                """() => {
                  highlightErrorFields([buildRuleJSON()]);
                  return [...document.querySelectorAll('.field-error')].map(el => el.dataset.field || el.id);
                }"""
            )
            assert "search-dest-lat-field" in marked, marked
            assert "search-detour" in marked, marked
            assert "search-dest-lng-field" not in marked, marked

            print("location_search_e2e: all assertions passed")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
