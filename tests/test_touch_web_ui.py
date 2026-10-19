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
        self.assertIn("confirmAction('測定を中止'", self.javascript)
        self.assertIn("confirmAction('測定結果を破棄'", self.javascript)
        self.assertIn("confirmAction('詰まり除去'", self.javascript)


if __name__ == "__main__":
    unittest.main()
