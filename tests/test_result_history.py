from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from service.result_history import (
    get_history_artifact,
    get_history_detail,
    list_history,
    scan_history,
)

ROOT = Path(__file__).resolve().parents[1]


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


class ResultHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = TemporaryDirectory(dir=ROOT)
        self.root = Path(self.temporary.name)
        metadata = {
            "timestamp": "20260101_120000",
            "dispenser_id": "disp-01",
            "material_name": "Sample A",
            "disk_id": "D01",
        }
        write_json(
            self.root / "all" / "all-run" / "result.json",
            {
                "metadata": metadata,
                "calibration": {"success": True, "selected_vib_level": 2, "level_results": []},
                "hausner": {
                    "bulk_density": {"success": True, "mean": 0.5},
                    "tapped_density": {"success": True, "mean": 0.6},
                    "ratio": 1.2,
                    "class": "Fair",
                },
                "angle_of_repose": {"success": True, "angle_deg": 34.5, "class": "Good"},
            },
        )
        image = self.root / "all" / "all-run" / "flowability" / "20260101_repose_fit.png"
        image.parent.mkdir(parents=True, exist_ok=True)
        image.write_bytes(b"png")
        for timestamp, stage, mean in (
            ("20260102_120000", "bulk_density", 0.4),
            ("20260102_130000", "tapped_density", 0.5),
        ):
            write_json(
                self.root / "single" / f"{timestamp}_{stage}" / "result.json",
                {
                    "metadata": {**metadata, "timestamp": timestamp, "stage": stage},
                    stage: {"success": True, "mean": mean, "stdev": 0.01, "densities": [mean]},
                },
            )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_scans_full_and_combined_single_results(self) -> None:
        records = scan_history(self.root)
        full = [record for record in records if record["source_kind"] == "all"]
        self.assertEqual({record["evaluation"] for record in full}, {"calibration", "hausner", "angle_of_repose"})
        combined = next(record for record in records if record["source_kind"] == "single" and record["evaluation"] == "hausner")
        self.assertAlmostEqual(combined["overview"]["hausner_ratio"], 1.25)
        self.assertEqual(combined["overview"]["hausner_class"], "Fair")
        self.assertEqual(len(combined["source_ids"]), 2)

    def test_index_is_lightweight_and_detail_is_resolvable(self) -> None:
        rows = list_history(self.root)
        self.assertNotIn("data", rows[0])
        self.assertNotIn("artifacts", rows[0])
        detail = get_history_detail(rows[0]["id"], self.root)
        self.assertIn("data", detail)
        self.assertEqual(detail["dispenser_id"], "disp-01")

    def test_failed_calibration_is_visible_in_history(self) -> None:
        write_json(
            self.root / "all" / "failed-run" / "result.json",
            {
                "metadata": {
                    "timestamp": "20260103_120000",
                    "material_name": "Sample A",
                    "disk_id": "D01",
                    "calibration_failed": True,
                    "failure_reason": "Priming failed.",
                },
            },
        )
        record = next(
            item
            for item in scan_history(self.root)
            if item["source_ids"] == ["failed-run"]
        )
        self.assertEqual(record["evaluation"], "calibration")
        self.assertFalse(record["overview"]["success"])
        self.assertEqual(record["overview"]["failure_reason"], "Priming failed.")

    def test_artifact_lookup_is_scoped_to_history_root(self) -> None:
        path, media_type = get_history_artifact("all", "all-run", "20260101_repose_fit.png", self.root)
        self.assertEqual(path.name, "20260101_repose_fit.png")
        self.assertEqual(media_type, "image/png")
        with self.assertRaises(ValueError):
            get_history_artifact("all", "../all-run", "20260101_repose_fit.png", self.root)
        with self.assertRaises(ValueError):
            get_history_artifact("all", "all-run", "../secret.png", self.root)


if __name__ == "__main__":
    unittest.main()
