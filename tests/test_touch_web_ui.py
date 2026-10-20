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

    def test_primary_navigation_has_four_touch_modes(self) -> None:
        nav = re.search(
            r'<nav id="main-nav".*?</nav>', self.html, flags=re.DOTALL
        )
        self.assertIsNotNone(nav)
        self.assertEqual(nav.group(0).count("data-page="), 4)
        for page in ("auto", "manual", "history", "materials"):
            self.assertIn(f'data-page="{page}"', nav.group(0))
        self.assertNotIn('data-page="single"', nav.group(0))

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
        self.assertIn(".main-nav", self.css)
        self.assertIn("grid-template-columns:repeat(4,1fr)", self.css)

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
        for evaluation in ("tapped_density", "bulk_density", "hausner"):
            self.assertIn(f'data-value="{evaluation}"', self.html)

    def test_manual_bulk_density_uses_three_touch_rows(self) -> None:
        self.assertIn('id="bulk-density-measurement"', self.html)
        self.assertIn('id="review-bulk-density"', self.html)
        self.assertEqual(self.html.count('data-field="mass_g"'), 3)
        self.assertEqual(self.html.count('data-field="volume_ml"'), 3)
        self.assertIn("/api/results/manual-bulk-density", self.javascript)

    def test_single_tests_show_confirmation_and_operation_mode(self) -> None:
        self.assertIn("confirmSingleTest", self.javascript)
        self.assertIn("Has the material priming been completed?", self.javascript)
        self.assertIn('id="repose-confirm-dialog"', self.html)
        self.assertIn('id="repose-confirm-image"', self.html)
        self.assertIn('id="retake-repose-image"', self.html)
        self.assertIn('id="analyze-repose-image"', self.html)
        self.assertIn("captureReposeConfirmationImage", self.javascript)
        self.assertIn("X-Repose-Preview-Id", self.javascript)
        self.assertIn("preview_id=${encodeURIComponent(previewId)}", self.javascript)
        self.assertEqual(self.html.count('class="mode-indicator automated"'), 4)
        self.assertEqual(self.html.count('class="mode-indicator manual"'), 1)
        self.assertNotIn("Enter an n=3 manual measurement", self.html)
        self.assertNotIn("Optimize vibration conditions", self.html)

    def test_manual_dispense_reports_status_without_opening_measurement_view(self) -> None:
        self.assertIn('id="manual-feedback"', self.html)
        self.assertIn('id="manual-run-status"', self.html)
        self.assertIn('id="manual-run-log"', self.html)
        self.assertIn("renderManualOperationState", self.javascript)
        manual_run = re.search(
            r"async function manualRun\(count=null\)\{(.*?)\n\}",
            self.javascript,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(manual_run)
        self.assertNotIn("showPage('auto')", manual_run.group(1))
        self.assertNotIn("showAutoView('run')", manual_run.group(1))

    def test_material_database_uses_sorted_table(self) -> None:
        self.assertIn('id="material-table-wrap"', self.html)
        self.assertIn('class="material-table"', self.javascript)
        self.assertIn("renderMaterialTable", self.javascript)
        self.assertNotIn('class="material-card"', self.javascript)
        self.assertIn("overflow:scroll", self.css)
        self.assertIn(".material-table-wrap::-webkit-scrollbar", self.css)
        self.assertIn("width:20px; height:20px", self.css)

    def test_calibration_history_uses_saved_images_not_browser_charts(self) -> None:
        calibration_branch = re.search(
            r"if\(record\.evaluation==='calibration'\)\{(.*?)\}\s*else if",
            self.javascript,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(calibration_branch)
        self.assertIn("$('history-charts').replaceChildren()", calibration_branch.group(1))
        self.assertNotIn("chartCard", calibration_branch.group(1))

    def test_result_images_stay_in_the_touch_workflow(self) -> None:
        self.assertIn(".artifacts { display:flex; flex-direction:column", self.css)
        self.assertIn("figure img { display:block; width:100%; height:auto", self.css)
        self.assertNotIn('target="_blank"', self.javascript)

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
