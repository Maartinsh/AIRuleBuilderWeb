import os
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("RULE_BUILDER_URL", "http://127.0.0.1:4173")


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        try:
            page.goto(BASE_URL, wait_until="networkidle")
            page.get_by_role("button", name="Mojo", exact=True).click()

            section = page.locator("#section-follow-up")
            section.wait_for(state="visible")
            page.evaluate(
                """
                () => {
                  const output = document.getElementById('output-enabled');
                  output.checked = true;
                  output.dispatchEvent(new Event('change', { bubbles: true }));
                  const input = document.getElementById('follow-up-enabled');
                  input.checked = true;
                  input.dispatchEvent(new Event('change', { bubbles: true }));
                }
                """
            )
            page.locator("#output-instructions").fill(
                "Tell the patient they completed the exercise."
            )
            page.locator("#follow-up-question").fill(
                "Would you like to continue the exercise?"
            )

            built = page.evaluate("buildRuleJSON()")
            assert built["followUp"] == {
                "id": "exercise_confirmation",
                "question": "Would you like to continue the exercise?",
            }
            assert "actions" not in built["followUp"]
            page.get_by_text("Confirm exercise", exact=True).wait_for()
            page.get_by_text("Deny exercise", exact=True).wait_for()
            if screenshot_path := os.environ.get("FOLLOW_UP_SCREENSHOT"):
                section.screenshot(path=screenshot_path)

            imported = page.evaluate(
                """
                () => {
                  populateFormFromRule({
                    id: 'imported',
                    output: { instructions: 'Imported output' },
                    followUp: { id: 'custom_stable_id', question: 'Continue this movement?' },
                    triggerExpression: { type: 'GROUP', groupType: 'AND', expressions: [] }
                  });
                  return buildRuleJSON().followUp;
                }
                """
            )
            assert imported == {
                "id": "custom_stable_id",
                "question": "Continue this movement?",
            }

            validation_errors = page.evaluate(
                """
                () => {
                  document.getElementById('output-enabled').checked = false;
                  return validateRule([buildRuleJSON()]).errors;
                }
                """
            )
            assert any('requires "output"' in error for error in validation_errors)

            page.evaluate("resetForm(true)")
            assert not page.locator("#follow-up-enabled").is_checked()
            assert page.locator("#follow-up-question").input_value() == ""

            page.get_by_role("button", name="Fleet", exact=True).click()
            assert section.is_hidden()
        finally:
            browser.close()


if __name__ == "__main__":
    main()
