from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from service.result_store import save_manual_bulk_density, save_results

ROOT = Path(__file__).resolve().parents[1]


class ManualBulkDensityTests(unittest.TestCase):
    def test_calculates_and_saves_three_replicates(self) -> None:
        with TemporaryDirectory(dir=ROOT) as temporary:
            log_root = Path(temporary) / "logs"
            settings = {
                "material": {"material_name": "Original", "part_type": "metal", "disk_id": "D01"},
                "paths": {"log_root": str(log_root)},
                "disk_master": {"D01": {"volume_ml": 1.0}},
            }
            with patch("service.result_store.load_settings", return_value=settings):
                result = save_manual_bulk_density(
                    material_name="Sample A",
                    disk_id="D01",
                    replicates=[
                        {"mass_g": 50.0, "volume_ml": 100.0},
                        {"mass_g": 51.0, "volume_ml": 100.0},
                        {"mass_g": 52.0, "volume_ml": 100.0},
                    ],
                    update_material_database=False,
                )

            density = result["bulk_density"]
            self.assertAlmostEqual(density["mean"], 0.51)
            self.assertAlmostEqual(density["stdev"], 0.01)
            self.assertEqual(density["measurement_method"], "manual_mass_volume")
            result_files = list((log_root / "single").glob("*/result.json"))
            self.assertEqual(len(result_files), 1)
            saved = json.loads(result_files[0].read_text(encoding="utf-8"))
            self.assertEqual(saved["bulk_density"]["volumes_ml"], [100.0, 100.0, 100.0])

    def test_automated_result_saves_tapped_density_without_hausner(self) -> None:
        with TemporaryDirectory(dir=ROOT) as temporary:
            log_root = Path(temporary) / "logs"
            settings = {
                "material": {"material_name": "Sample B", "part_type": "metal", "disk_id": "D01"},
                "paths": {"log_root": str(log_root)},
            }
            result_data = {
                "metadata": {
                    "run_id": "20261019_120000_Sample B",
                    "timestamp": "20261019_120000",
                    "app_settings": settings,
                },
                "calibration": {
                    "level_results": [],
                    "time_results": [],
                    "stability_results": [],
                    "selected_vib_level": 2,
                    "selected_vib_time": 1.0,
                    "step_mass_mean": 0.5,
                },
                "tapped_density": {
                    "mean": 0.65,
                    "stdev": 0.01,
                    "masses": [0.64, 0.65, 0.66],
                    "densities": [0.64, 0.65, 0.66],
                    "success": True,
                },
                "angle_of_repose": {"angle_deg": 32.0, "class": "Good", "success": True},
            }
            with patch("service.result_store.load_settings", return_value=settings):
                save_results({"result_data": result_data, "artifacts": {}})

            run_dir = log_root / "all" / "20261019_120000_Sample B"
            saved = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
            self.assertIn("tapped_density", saved)
            self.assertNotIn("hausner", saved)
            self.assertTrue(list((run_dir / "flowability").glob("*tapped_density_raw.csv")))


if __name__ == "__main__":
    unittest.main()
