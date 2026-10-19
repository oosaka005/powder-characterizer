from __future__ import annotations

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "web_ui_gateway" / "static"


class TouchWebUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (STATIC / "index.html").read_text(encoding="utf-8")
        cls.css = (STATIC / "styles.css").read_text(encoding="utf-8")
        cls.javascript = (STATIC / "app.js").read_text(encoding="utf-8")

    def test_primary_navigation_has_five_touch_modes(self) -> None:
        nav = re.search(
            r'<nav id="main-nav".*?</nav>', self.html, flags=re.DOTALL
        )
        self.assertIsNotNone(nav)
        self.assertEqual(nav.group(0).count("data-page="), 5)
        for page in ("auto", "manual", "single", "history", "materials"):
            self.assertIn(f'data-page="{page}"', nav.group(0))

    def test_setup_uses_touch_controls_instead_of_direct_text_fields(self) -> None:
        self.assertNotRegex(self.html, r'<input[^>]+type="(?:text|number)"')
        for control_id in (
            "material_name",
            "disk_id",
            "vib_levels",
            "vib_times",
            "steps_per_level",
            "stability_steps",
            "numeric-dialog",
            "text-dialog",
        ):
            self.assertIn(f'id="{control_id}"', self.html)

    def test_touch_target_and_small_screen_rules_are_present(self) -> None:
        self.assertIn("--touch:56px", self.css)
        self.assertIn("min-height:var(--touch)", self.css)
        self.assertIn("@media (max-width:700px)", self.css)
        self.assertIn("grid-template-columns:repeat(5,1fr)", self.css)

    def test_history_view_is_touch_selectable_and_two_level(self) -> None:
        for control_id in (
            "history-dispenser",
            "history-material",
            "history-disk",
            "history-evaluation",
            "history-record",
            "history-overview",
            "history-details",
        ):
            self.assertIn(f'id="{control_id}"', self.html)
        self.assertIn("renderHistoryCharts", self.javascript)
        self.assertIn("renderHistoryArtifacts", self.javascript)

    def test_high_consequence_actions_use_confirmation_dialog(self) -> None:
        self.assertIn("confirmAction('Abort Measurement'", self.javascript)
        self.assertIn("confirmAction('Discard Result'", self.javascript)
        self.assertIn("confirmAction('Clear Clog'", self.javascript)

    def test_source_code_contains_no_japanese_characters(self) -> None:
        japanese = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")
        suffixes = {".py", ".js", ".html", ".css", ".sh"}
        excluded_parts = {".git", ".pytest_cache", "logs", "output"}
        offenders = []
        for path in ROOT.rglob("*"):
            if path.suffix.lower() not in suffixes:
                continue
            if any(part in excluded_parts for part in path.parts):
                continue
            if japanese.search(path.read_text(encoding="utf-8", errors="ignore")):
                offenders.append(str(path.relative_to(ROOT)))
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
