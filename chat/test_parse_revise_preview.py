"""Smoke tests for preview revision JSON parsing fallbacks."""

from tool_creator import build_revise_preview_user_content, parse_revise_preview_response


def test_revise_user_content_includes_ui_files():
    content = build_revise_preview_user_content(
        tool_name="notes",
        feedback="fix add button",
        manifest_json='{"kind": "interactive"}',
        tool_code="def run(): pass",
        test_code="assert True",
        screenshot_b64=None,
        ui_files={"app.js": "AdaSkill.init();"},
    )
    assert isinstance(content, str)
    assert "Current ui_files" in content
    assert "AdaSkill.init()" in content


def test_malformed_json_extracts_tool_code():
    tool_body = "def run(): return True\n" + "# comment\n" * 100
    # Valid-looking start, then broken JSON property name (like column 10681 errors)
    raw = (
        '{"tool_code": "'
        + tool_body.replace('"', '\\"')
        + '", "test_code": "importlib\\nassert True", '
        + '"manifest": {"kind": "interactive", bad_key: 1}}'
    )
    tool, test, manifest, ui_files = parse_revise_preview_response(
        raw,
        fallback_tool="fallback",
        fallback_test="fallback",
        fallback_manifest={"kind": "interactive"},
    )
    assert "def run()" in tool
    assert "importlib" in test
    assert manifest is not None
    assert manifest.get("kind") == "interactive"
    assert ui_files is None


if __name__ == "__main__":
    test_revise_user_content_includes_ui_files()
    test_malformed_json_extracts_tool_code()
    print("ok")
