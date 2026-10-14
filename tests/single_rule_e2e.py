import json
import os
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get('RULE_BUILDER_URL', 'http://127.0.0.1:4173')
RULE = {
    'id': 'single_rule',
    'sessionScope': 'activity',
    'throttle': {'cooldownMinutes': 30, 'maxTriggersPerDay': 3},
    'output': {'instructions': 'Say something.'},
    'triggerExpression': {'type': 'SINGLE', 'id': 'trip_ended', 'dataSource': 'SmartDrive'},
}


def upload(page, data):
    page.evaluate("document.getElementById('toast').textContent = ''")
    page.locator('#upload-json-input').set_input_files({
        'name': 'rule.json', 'mimeType': 'application/json',
        'buffer': json.dumps(data).encode(),
    })
    page.wait_for_function("document.getElementById('toast').textContent.length > 0")


def preview(page):
    return json.loads(page.locator('#preview-body').inner_text())


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            page.goto(BASE_URL, wait_until='networkidle')
            assert page.get_by_role('button', name='+ Add Rule', exact=True).count() == 0
            assert page.get_by_title('Duplicate rule').count() == 0
            assert page.get_by_title('Delete rule', exact=True).count() == 0

            envelope = {'schemaVersion': '1.0.0', 'rules': [RULE]}
            for data in (RULE, [RULE], envelope, [envelope]):
                upload(page, data)
                page.wait_for_function("rules.length === 1 && rules[0].id === 'single_rule'")
                assert preview(page)['rules'] == [RULE]
                assert preview(page)['schemaVersion'] == '1.0.0'

            topical = {**RULE, 'topic': 'safety'}
            upload(page, [{'schemaVersion': '1.0.0', 'topics': {'safety': {'tone': 'calm'}}, 'rules': [topical]}])
            page.wait_for_function("rules[0].topic === 'safety'")
            assert preview(page)['topics']['safety']['tone'] == 'calm'
            before = preview(page)
            for data in ([RULE, {**RULE, 'id': 'other'}], {'rules': [RULE, RULE]}, [{'rules': [RULE, RULE]}], [], None):
                upload(page, data)
                page.wait_for_function("document.getElementById('toast').textContent.includes('one rule')")
                assert preview(page) == before

            page.evaluate("_ghGet = async () => ({content: btoa(JSON.stringify({rules: [{id: 'a'}, {id: 'b'}]}))})")
            page.evaluate("loadVersion('old_multi_rule_version', 'Old version')")
            page.wait_for_function("document.getElementById('toast').textContent.startsWith('Load failed:')")
            assert preview(page) == before

            with page.expect_download() as download_info:
                page.get_by_role('button', name='Download', exact=True).click()
            download = download_info.value
            assert download.suggested_filename == 'single_rule.json'
            with open(download.path()) as file:
                assert json.load(file) == before

            page.once('dialog', lambda dialog: dialog.dismiss())
            page.get_by_role('button', name='+ New Rule', exact=True).click()
            assert preview(page) == before
            page.evaluate("_setLoadedBadge('Loaded version', 'old_version')")
            page.once('dialog', lambda dialog: dialog.accept())
            page.get_by_role('button', name='+ New Rule', exact=True).click()
            assert len(preview(page)['rules']) == 1
            assert preview(page)['rules'][0]['id'] != RULE['id']
            assert page.evaluate('_loadedVersionId') is None
            assert page.evaluate('Object.keys(topicConfigs).length') == 0

            upload(page, envelope)
            page.wait_for_function("rules[0].id === 'single_rule'")
            page.screenshot(path='/tmp/single-rule-desktop.png', full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844})
            page.screenshot(path='/tmp/single-rule-mobile.png', full_page=True)
            assert page.locator('#rule-list .rule-list-item').count() == 1
            assert errors == [], errors
            assert not page.evaluate('(rule) => validateRule([rule, rule]).valid', RULE)
            print('single_rule_e2e: all assertions passed')
        finally:
            browser.close()


if __name__ == '__main__':
    main()
