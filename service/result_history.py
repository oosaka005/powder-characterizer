from __future__ import annotations

import csv
import hashlib
import json
import math
import mimetypes
from pathlib import Path
import re
from statistics import mean, stdev
from typing import Any, Iterable

from service.settings_store import load_settings


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DISPENSER_ID = "powder_dispenser"
EVALUATIONS = {"calibration", "hausner", "angle_of_repose"}
SOURCE_LABELS = {
    "all": "自動評価",
    "single": "個別試験",
    "old": "旧形式",
}


def _log_root() -> Path:
    configured = Path(load_settings(PROJECT_ROOT / "config" / "app_settings.json")["paths"]["log_root"])
    return configured if configured.is_absolute() else PROJECT_ROOT / configured


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _classify_hausner(ratio: float | None) -> str | None:
    if ratio is None:
        return None
    for maximum, label in (
        (1.11, "Excellent"),
        (1.18, "Good"),
        (1.25, "Fair"),
        (1.34, "Passable"),
        (1.45, "Poor"),
        (1.59, "Very poor"),
    ):
        if ratio <= maximum:
            return label
    return "Very, very poor"


def _record_id(evaluation: str, sources: Iterable[str]) -> str:
    raw = "|".join([evaluation, *sources])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


def _metadata_values(payload: dict[str, Any]) -> tuple[str, str, str, str]:
    metadata = payload.get("metadata", {})
    app_material = metadata.get("app_settings", {}).get("material", {})
    dispenser_id = str(metadata.get("dispenser_id") or DEFAULT_DISPENSER_ID)
    material_name = str(metadata.get("material_name") or app_material.get("material_name") or "Unknown")
    disk_id = str(metadata.get("disk_id") or app_material.get("disk_id") or "Unknown")
    timestamp = str(metadata.get("timestamp") or "")
    return dispenser_id, material_name, disk_id, timestamp


def _artifact_label(filename: str) -> str:
    lowered = filename.lower()
    if "level_exploration" in lowered:
        return "振動レベル探索"
    if "vib_time_exploration" in lowered or "time_exploration" in lowered:
        return "振動時間探索"
    if "stability" in lowered:
        return "安定性確認"
    if "cropped" in lowered:
        return "切り出し画像"
    if "processed" in lowered:
        return "輪郭処理画像"
    if "fit" in lowered:
        return "フィッティング結果"
    if "raw_image" in lowered:
        return "撮影画像"
    return filename


def _artifacts(run_dir: Path, kind: str, evaluation: str) -> list[dict[str, str]]:
    candidates: list[Path] = []
    for path in run_dir.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
            continue
        lowered = path.name.lower()
        if evaluation == "calibration" and any(
            token in lowered for token in ("level_exploration", "time_exploration", "stability")
        ):
            candidates.append(path)
        elif evaluation == "angle_of_repose" and any(
            token in lowered for token in ("raw_image", "cropped", "processed", "fit")
        ):
            candidates.append(path)

    order = {
        "level_exploration": 0,
        "time_exploration": 1,
        "stability": 2,
        "cropped": 3,
        "processed": 4,
        "fit": 5,
        "raw_image": 6,
    }

    def sort_key(path: Path) -> tuple[int, str]:
        lowered = path.name.lower()
        rank = min((value for token, value in order.items() if token in lowered), default=99)
        return rank, path.name

    return [
        {
            "label": _artifact_label(path.name),
            "kind": kind,
            "run_id": run_dir.name,
            "filename": path.name,
        }
        for path in sorted(candidates, key=sort_key)
    ]


def _base_record(
    *,
    evaluation: str,
    source_kind: str,
    source_ids: list[str],
    dispenser_id: str,
    material_name: str,
    disk_id: str,
    timestamp: str,
    overview: dict[str, Any],
    data: dict[str, Any],
    artifacts: list[dict[str, str]],
    source_label: str | None = None,
) -> dict[str, Any]:
    return {
        "id": _record_id(evaluation, [source_kind, *source_ids]),
        "evaluation": evaluation,
        "source_kind": source_kind,
        "source_label": source_label or SOURCE_LABELS[source_kind],
        "source_ids": source_ids,
        "dispenser_id": dispenser_id,
        "material_name": material_name,
        "disk_id": disk_id,
        "timestamp": timestamp,
        "overview": overview,
        "data": data,
        "artifacts": artifacts,
    }


def _calibration_record(
    payload: dict[str, Any], run_dir: Path, kind: str
) -> dict[str, Any] | None:
    calibration = payload.get("calibration")
    if not isinstance(calibration, dict):
        metadata = payload.get("metadata", {})
        success = metadata.get("success", {})
        explicit_failure = (
            isinstance(success, dict) and success.get("calibration") is False
        ) or metadata.get("calibration_failed") is True
        if not explicit_failure:
            return None
        calibration = {
            "success": False,
            "failure_reason": metadata.get("failure_reason"),
        }
    dispenser, material, disk, timestamp = _metadata_values(payload)
    return _base_record(
        evaluation="calibration",
        source_kind=kind,
        source_ids=[run_dir.name],
        dispenser_id=dispenser,
        material_name=material,
        disk_id=disk,
        timestamp=timestamp,
        overview={
            "success": calibration.get("success"),
            "selected_vib_level": calibration.get("selected_vib_level"),
            "selected_vib_time": calibration.get("selected_vib_time"),
            "step_mass_mean": calibration.get("step_mass_mean"),
            "step_mass_std": calibration.get("step_mass_std"),
            "density_g_per_ml": calibration.get("density_g_per_ml"),
            "failure_reason": calibration.get("failure_reason"),
        },
        data=calibration,
        artifacts=_artifacts(run_dir, kind, "calibration"),
    )


def _hausner_record(
    payload: dict[str, Any], run_dir: Path, kind: str
) -> dict[str, Any] | None:
    hausner = payload.get("hausner")
    if not isinstance(hausner, dict):
        return None
    dispenser, material, disk, timestamp = _metadata_values(payload)
    bulk = hausner.get("bulk_density") or {}
    tapped = hausner.get("tapped_density") or {}
    return _base_record(
        evaluation="hausner",
        source_kind=kind,
        source_ids=[run_dir.name],
        dispenser_id=dispenser,
        material_name=material,
        disk_id=disk,
        timestamp=timestamp,
        overview={
            "success": bool(bulk.get("success")) and bool(tapped.get("success")),
            "bulk_density_mean": bulk.get("mean"),
            "bulk_density_stdev": bulk.get("stdev"),
            "tapped_density_mean": tapped.get("mean"),
            "tapped_density_stdev": tapped.get("stdev"),
            "hausner_ratio": hausner.get("ratio"),
            "hausner_class": hausner.get("class"),
        },
        data=hausner,
        artifacts=[],
    )


def _repose_record(
    payload: dict[str, Any], run_dir: Path, kind: str
) -> dict[str, Any] | None:
    repose = payload.get("angle_of_repose")
    if not isinstance(repose, dict):
        return None
    dispenser, material, disk, timestamp = _metadata_values(payload)
    return _base_record(
        evaluation="angle_of_repose",
        source_kind=kind,
        source_ids=[run_dir.name],
        dispenser_id=dispenser,
        material_name=material,
        disk_id=disk,
        timestamp=timestamp,
        overview={
            "success": repose.get("success"),
            "angle_deg": repose.get("angle_deg"),
            "repose_class": repose.get("class"),
        },
        data=repose,
        artifacts=_artifacts(run_dir, kind, "angle_of_repose"),
    )


def _read_csv(path: Path) -> list[dict[str, str]]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            return list(csv.DictReader(handle))
    except OSError:
        return []


_CONDITION_RE = re.compile(r"level(?P<level>\d+)_t(?P<time>[0-9.]+)")


def _series_from_csv(path: Path) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, str]]] = {}
    for row in _read_csv(path):
        grouped.setdefault(row.get("condition", "unknown"), []).append(row)
    results: list[dict[str, Any]] = []
    for condition, rows in grouped.items():
        match = _CONDITION_RE.fullmatch(condition)
        per_step = [_number(row.get("per_step_mass_g")) for row in rows]
        cumulative = [_number(row.get("cumulative_mass_g")) for row in rows]
        successes = [str(row.get("success", "")).lower() == "true" for row in rows]
        results.append(
            {
                "level": int(match.group("level")) if match else None,
                "vib_time": float(match.group("time")) if match else None,
                "per_step": per_step,
                "cumulative": cumulative,
                "successes": successes,
                "success_all": all(successes),
            }
        )
    return results


def _legacy_records(run_dir: Path) -> list[dict[str, Any]]:
    summaries = list((run_dir / "flowability").glob("*flowability_summary.csv"))
    if not summaries:
        return []
    rows = _read_csv(summaries[0])
    if not rows:
        return []
    summary = rows[0]
    timestamp = summary.get("measurement_date") or run_dir.name[:15]
    material = summary.get("material_name") or run_dir.name[16:]
    disk = summary.get("disk_id") or "Unknown"

    level_files = list((run_dir / "calibration").glob("*level_exploration.csv"))
    time_files = list((run_dir / "calibration").glob("*vib_time_exploration.csv"))
    stability_files = list((run_dir / "calibration").glob("*stability*.csv"))
    level_results = _series_from_csv(level_files[0]) if level_files else []
    time_results = _series_from_csv(time_files[0]) if time_files else []
    stability_results = _series_from_csv(stability_files[-1]) if stability_files else []
    masses = [value for result in stability_results for value in result.get("per_step", []) if value is not None]
    calibration = {
        "success": bool(stability_results),
        "selected_vib_level": _number(summary.get("vib_level")),
        "selected_vib_time": _number(summary.get("vib_sec")),
        "step_mass_mean": mean(masses) if masses else None,
        "step_mass_std": stdev(masses) if len(masses) > 1 else None,
        "level_results": level_results,
        "time_results": time_results,
        "stability_results": stability_results,
    }

    hausner_raw_files = list((run_dir / "flowability").glob("*hausner_raw.csv"))
    raw_rows = _read_csv(hausner_raw_files[0]) if hausner_raw_files else []
    bulk_rows = [row for row in raw_rows if row.get("mode") == "bulk"]
    tapped_rows = [row for row in raw_rows if row.get("mode") == "tapped"]
    bulk = {
        "masses": [_number(row.get("mass_g")) for row in bulk_rows],
        "densities": [_number(row.get("density_g_per_ml")) for row in bulk_rows],
        "mean": _number(summary.get("bulk_density_mean")),
        "stdev": _number(summary.get("bulk_density_stdev")),
        "success": _number(summary.get("bulk_density_mean")) is not None,
    }
    tapped = {
        "masses": [_number(row.get("mass_g")) for row in tapped_rows],
        "densities": [_number(row.get("density_g_per_ml")) for row in tapped_rows],
        "mean": _number(summary.get("tapped_density_mean")),
        "stdev": _number(summary.get("tapped_density_stdev")),
        "success": _number(summary.get("tapped_density_mean")) is not None,
    }
    hausner = {
        "bulk_density": bulk,
        "tapped_density": tapped,
        "ratio": _number(summary.get("hausner_ratio")),
        "class": summary.get("hausner_class") or None,
    }
    repose = {
        "angle_deg": _number(summary.get("angle_of_repose_deg")),
        "class": summary.get("repose_class") or None,
        "success": _number(summary.get("angle_of_repose_deg")) is not None,
    }
    metadata = {
        "dispenser_id": DEFAULT_DISPENSER_ID,
        "material_name": material,
        "disk_id": disk,
        "timestamp": timestamp,
    }
    payloads = [
        {"metadata": metadata, "calibration": calibration},
        {"metadata": metadata, "hausner": hausner},
        {"metadata": metadata, "angle_of_repose": repose},
    ]
    builders = (_calibration_record, _hausner_record, _repose_record)
    return [record for record in (builder(payload, run_dir, "old") for builder, payload in zip(builders, payloads)) if record]


def _single_hausner_records(single_payloads: list[tuple[Path, dict[str, Any]]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], dict[str, list[tuple[Path, dict[str, Any]]]]] = {}
    for run_dir, payload in single_payloads:
        metadata = payload.get("metadata", {})
        stage = metadata.get("stage")
        if stage not in {"bulk_density", "tapped_density"}:
            continue
        dispenser, material, disk, _ = _metadata_values(payload)
        grouped.setdefault((dispenser, material, disk), {"bulk_density": [], "tapped_density": []})[stage].append((run_dir, payload))

    records: list[dict[str, Any]] = []
    for (dispenser, material, disk), stages in grouped.items():
        bulk_source = max(stages["bulk_density"], key=lambda item: _metadata_values(item[1])[3], default=None)
        tapped_source = max(stages["tapped_density"], key=lambda item: _metadata_values(item[1])[3], default=None)
        if bulk_source is None and tapped_source is None:
            continue
        bulk = bulk_source[1].get("bulk_density", {}) if bulk_source else {}
        tapped = tapped_source[1].get("tapped_density", {}) if tapped_source else {}
        bulk_mean = _number(bulk.get("mean"))
        tapped_mean = _number(tapped.get("mean"))
        ratio = tapped_mean / bulk_mean if bulk_mean and tapped_mean else None
        classification = _classify_hausner(ratio)
        sources = [source for source in (bulk_source, tapped_source) if source]
        source_ids = [source[0].name for source in sources]
        timestamp = max((_metadata_values(source[1])[3] for source in sources), default="")
        data = {"bulk_density": bulk, "tapped_density": tapped, "ratio": ratio, "class": classification}
        records.append(
            _base_record(
                evaluation="hausner",
                source_kind="single",
                source_ids=source_ids,
                dispenser_id=dispenser,
                material_name=material,
                disk_id=disk,
                timestamp=timestamp,
                source_label="個別試験（最新の組合せ）",
                overview={
                    "success": bool(bulk.get("success")) and bool(tapped.get("success")),
                    "bulk_density_mean": bulk.get("mean"),
                    "bulk_density_stdev": bulk.get("stdev"),
                    "tapped_density_mean": tapped.get("mean"),
                    "tapped_density_stdev": tapped.get("stdev"),
                    "hausner_ratio": ratio,
                    "hausner_class": classification,
                },
                data=data,
                artifacts=[],
            )
        )
    return records


def scan_history(log_root: Path | None = None) -> list[dict[str, Any]]:
    root = (log_root or _log_root()).resolve()
    records: list[dict[str, Any]] = []
    for run_dir in sorted((root / "all").glob("*")) if (root / "all").exists() else ():
        if not run_dir.is_dir():
            continue
        payload = _read_json(run_dir / "result.json")
        if payload is None:
            continue
        for builder in (_calibration_record, _hausner_record, _repose_record):
            record = builder(payload, run_dir, "all")
            if record:
                records.append(record)

    single_payloads: list[tuple[Path, dict[str, Any]]] = []
    for run_dir in sorted((root / "single").glob("*")) if (root / "single").exists() else ():
        if not run_dir.is_dir():
            continue
        payload = _read_json(run_dir / "result.json")
        if payload is None:
            continue
        single_payloads.append((run_dir, payload))
        stage = payload.get("metadata", {}).get("stage")
        builder = _calibration_record if stage == "calibration" else _repose_record if stage == "angle_of_repose" else None
        if builder:
            record = builder(payload, run_dir, "single")
            if record:
                records.append(record)
    records.extend(_single_hausner_records(single_payloads))

    for run_dir in sorted((root / "old").glob("*")) if (root / "old").exists() else ():
        if run_dir.is_dir():
            records.extend(_legacy_records(run_dir))

    return sorted(records, key=lambda record: record["timestamp"], reverse=True)


def list_history(log_root: Path | None = None) -> list[dict[str, Any]]:
    return [
        {key: value for key, value in record.items() if key not in {"data", "artifacts"}}
        for record in scan_history(log_root)
    ]


def get_history_detail(record_id: str, log_root: Path | None = None) -> dict[str, Any]:
    for record in scan_history(log_root):
        if record["id"] == record_id:
            return record
    raise FileNotFoundError(f"History record not found: {record_id}")


def get_history_artifact(
    kind: str,
    run_id: str,
    filename: str,
    log_root: Path | None = None,
) -> tuple[Path, str]:
    if kind not in {"all", "single", "old"}:
        raise ValueError("Unknown history source kind.")
    if Path(run_id).name != run_id or Path(filename).name != filename:
        raise ValueError("History paths must not contain path separators.")
    root = (log_root or _log_root()).resolve()
    run_dir = (root / kind / run_id).resolve()
    if root not in run_dir.parents or not run_dir.is_dir():
        raise FileNotFoundError(f"History run not found: {kind}/{run_id}")
    for path in run_dir.rglob(filename):
        resolved = path.resolve()
        if path.is_file() and path.name == filename and (resolved == run_dir or run_dir in resolved.parents):
            media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            return path, media_type
    raise FileNotFoundError(f"History artifact not found: {kind}/{run_id}/{filename}")
