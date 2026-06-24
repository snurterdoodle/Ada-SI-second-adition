"""Tests for forge codegen profile routing."""

from forge_routing import infer_codegen_profile, infer_revise_profile


def test_infer_headless_from_plan():
    plan = "## Skill Kind\nHeadless weather fetcher.\n"
    assert infer_codegen_profile(plan) == "headless"


def test_infer_builtin_list_from_plan():
    plan = "Interactive todo app. Template: list. Operations: list_tasks, add_task."
    assert infer_codegen_profile(plan) == "interactive_builtin"


def test_infer_custom_from_plan():
    plan = "INTERACTIVE notes app. Template: custom iframe with HTML/CSS/JS."
    assert infer_codegen_profile(plan) == "interactive_custom"


def test_infer_from_manifest_edit_flow():
    manifest = {
        "kind": "interactive",
        "ui": {"template": "custom", "actions": {"create": "add_note"}},
    }
    assert infer_codegen_profile("ignored", manifest=manifest) == "interactive_custom"


def test_infer_revise_profile():
    builtin = {"kind": "interactive", "ui": {"template": "list"}}
    custom = {"kind": "interactive", "ui": {"template": "custom"}}
    assert infer_revise_profile(builtin) == "interactive_builtin"
    assert infer_revise_profile(custom) == "interactive_custom"


if __name__ == "__main__":
    test_infer_headless_from_plan()
    test_infer_builtin_list_from_plan()
    test_infer_custom_from_plan()
    test_infer_from_manifest_edit_flow()
    test_infer_revise_profile()
    print("All test_forge_routing tests passed.")
