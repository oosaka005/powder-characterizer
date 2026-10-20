from __future__ import annotations

from unittest.mock import patch

import pytest

from operation.fakes import FakeBalance, FakePowderDispenser
from operation.powder_flow_api import measure_series
from operation.workflows import _run_repose, run_manual_experiment, run_single_test
from sila2_servers.powder_characterizer_dispenser_server.drivers.powder_dispenser import (
    AmbiguousDeviceError,
    DeviceNotConnectedError,
    PowderCharacterizerDispenser,
)
from sila2_servers.powder_characterizer_dispenser_server.feature_implementations.powdercharacterizerdispenser_impl import (
    PowderCharacterizerDispenserImpl,
)
from sila2_servers.powder_characterizer_dispenser_server.generated.powdercharacterizerdispenser import (
    DeviceNotConnected,
)
from sila2_servers.powder_characterizer_server.devices.sila_adapters import (
    BalanceSilaAdapter,
    PowderDispenserSilaAdapter,
)
from sila2_servers.powder_characterizer_server.application.characterizer import (
    PowderCharacterizerApplication,
)


def test_manual_sequence_is_vibrate_then_index_and_stops() -> None:
    dispenser = FakePowderDispenser()

    result = run_manual_experiment(
        vib_level=3,
        vib_seconds=1.25,
        dose_count=2,
        use_aug=True,
        powder_dispenser=dispenser,
    )

    assert result["requested_steps"] == 2
    assert result["succeeded_steps"] == 2
    assert result["success"] is True
    assert result["failed_step"] is None
    assert dispenser.calls == [
        ("vibrate_with_auger", 3, 1.25),
        ("index_chamber", 255, 0.65, False),
        ("vibrate_with_auger", 3, 1.25),
        ("index_chamber", 255, 0.65, False),
        ("stop_all",),
    ]


def test_manual_sequence_reports_rotation_motor_stop_reason() -> None:
    class TimedOutDispenser(FakePowderDispenser):
        def index_chamber(self, *args, **kwargs):
            self.calls.append(("index_chamber", 255, 0.65, False))
            return {"success": False, "stop_reason": "timeout", "elapsed_sec": 0.65}

    dispenser = TimedOutDispenser()
    result = run_manual_experiment(
        vib_level=0,
        vib_seconds=0,
        dose_count=2,
        use_aug=False,
        powder_dispenser=dispenser,
    )

    assert result["success"] is False
    assert result["succeeded_steps"] == 0
    assert result["failed_step"] == {
        "attempt": 1,
        "stop_reason": "timeout",
        "elapsed_sec": 0.65,
    }


def test_measure_series_preserves_pre_vibrate_tare_then_step_vibrate_read() -> None:
    dispenser = FakePowderDispenser()
    balance = FakeBalance([0.2, 0.5])

    result = measure_series(
        balance,
        level=2,
        vib_time=1.0,
        steps=2,
        noise_threshold_g=0.001,
        powder_dispenser=dispenser,
    )

    assert result["cumulative"] == [0.2, 0.5]
    assert dispenser.calls == [
        ("vibrate", 2, 1.0),
        ("index_chamber", 255, 0.65, False),
        ("vibrate", 2, 1.0),
        ("index_chamber", 255, 0.65, False),
        ("vibrate", 2, 1.0),
    ]
    assert balance.calls == [("tare",), ("read_weight",), ("read_weight",)]


def test_i2c_discovery_accepts_any_single_address_and_ignores_all_call() -> None:
    assert PowderCharacterizerDispenser.select_bonnet_address([0x42, 0x70]) == 0x42
    assert PowderCharacterizerDispenser.select_bonnet_address([0x61, 0x70]) == 0x61

    with pytest.raises(DeviceNotConnectedError):
        PowderCharacterizerDispenser.select_bonnet_address([0x70])
    with pytest.raises(AmbiguousDeviceError):
        PowderCharacterizerDispenser.select_bonnet_address([0x42, 0x61, 0x70])


def test_disconnected_driver_is_reported_as_declared_sila_error() -> None:
    def unavailable() -> None:
        raise DeviceNotConnectedError("No I2C device was found.")

    with pytest.raises(DeviceNotConnected, match="No I2C device was found"):
        PowderCharacterizerDispenserImpl._call_driver(unavailable)


def test_server_driver_stays_alive_waiting_when_i2c_is_absent() -> None:
    class EmptyBus:
        def try_lock(self) -> bool:
            return True

        def scan(self) -> list[int]:
            return []

        def unlock(self) -> None:
            return None

    driver = PowderCharacterizerDispenser(
        i2c_factory=EmptyBus,
        discover_on_start=False,
        acquire_ownership_lock=False,
    )

    with pytest.raises(DeviceNotConnectedError):
        driver.index_chamber()
    assert driver.status == "waiting_for_device"


class _BalanceFeature:
    def __init__(self) -> None:
        self.close_called = False

    def Close(self):
        self.close_called = True


class _Client:
    def __init__(self) -> None:
        self.Balance = _BalanceFeature()
        self.channel_closed = False

    def close(self) -> None:
        self.channel_closed = True


def test_balance_adapter_disconnect_never_calls_remote_close() -> None:
    client = _Client()
    adapter = BalanceSilaAdapter(client)  # type: ignore[arg-type]

    adapter.disconnect()

    assert client.channel_closed is True
    assert client.Balance.close_called is False


def test_abort_stop_prevents_later_motor_commands_in_same_operation() -> None:
    class DispenserFeature:
        def __init__(self) -> None:
            self.index_calls = 0
            self.stop_calls = 0

        def StopAll(self) -> None:
            self.stop_calls += 1

        def IndexChamber(self, **kwargs):
            self.index_calls += 1
            raise AssertionError("IndexChamber must not be sent after StopAll")

    class Client:
        def __init__(self) -> None:
            self.PowderCharacterizerDispenser = DispenserFeature()

        def close(self) -> None:
            return None

    client = Client()
    adapter = PowderDispenserSilaAdapter(client)  # type: ignore[arg-type]
    adapter.stop_all()

    with pytest.raises(RuntimeError, match="stopped"):
        adapter.index_chamber()
    assert client.PowderCharacterizerDispenser.stop_calls == 1
    assert client.PowderCharacterizerDispenser.index_calls == 0


def test_second_layer_manual_operation_uses_injected_first_layer_adapter() -> None:
    dispenser = FakePowderDispenser()

    class Factory:
        def create_dispenser(self):
            return dispenser

    application = PowderCharacterizerApplication(device_factory=Factory())  # type: ignore[arg-type]
    result = application.run_manual(
        vib_level=2,
        vib_seconds=0.5,
        dose_count=1,
        use_aug=False,
    )

    assert result["succeeded_steps"] == 1
    assert application.snapshot()["status"] == "completed"
    assert dispenser.calls == [
        ("vibrate", 2, 0.5),
        ("index_chamber", 255, 0.65, False),
        ("stop_all",),
        ("close",),
    ]


def test_prepared_repose_workflow_does_not_create_other_devices() -> None:
    repose_result = {
        "angle_of_repose": {"angle_deg": 32.0, "class": "Good", "success": True},
        "artifacts": {},
    }
    with (
        patch("operation.local_devices.create_local_dispenser") as create_dispenser,
        patch("operation.local_devices.create_local_balance") as create_balance,
        patch("operation.local_devices.create_local_camera") as create_camera,
        patch("operation.workflows._run_repose", return_value=repose_result) as run_repose,
    ):
        result = run_single_test(
            stage="angle_of_repose",
            prepared_repose_image=b"confirmed-image",
        )

    create_dispenser.assert_not_called()
    create_balance.assert_not_called()
    create_camera.assert_not_called()
    assert run_repose.call_args.kwargs["camera"] is None
    assert run_repose.call_args.kwargs["prepared_image_bytes"] == b"confirmed-image"
    assert result["metadata"]["stage"] == "angle_of_repose"


def test_prepared_repose_application_uses_preview_without_device_bundle() -> None:
    class Camera:
        def close(self) -> None:
            return None

    class Factory:
        def __init__(self) -> None:
            self.camera_calls = 0
            self.bundle_calls = 0

        def create_camera(self):
            self.camera_calls += 1
            return Camera()

        def create(self):
            self.bundle_calls += 1
            raise AssertionError("Prepared repose must not create a full device bundle")

    factory = Factory()
    application = PowderCharacterizerApplication(device_factory=factory)  # type: ignore[arg-type]
    preview_result = {
        "action": "camera_preview",
        "filename": "preview.png",
        "image_bytes": b"display-image",
        "source_image_bytes": b"source-image",
    }
    completed_result = {
        "metadata": {
            "material_name": "Sample",
            "disk_id": "D06",
            "timestamp": "20261019_120000",
            "stage": "angle_of_repose",
            "success": True,
        },
        "result_data": {
            "angle_of_repose": {"angle_deg": 32.0, "class": "Good", "success": True}
        },
        "artifacts": {},
    }

    with patch(
        "sila2_servers.powder_characterizer_server.application.characterizer.run_capture_repose_preview",
        return_value=preview_result,
    ):
        preview = application.capture_repose_preview()

    with patch(
        "sila2_servers.powder_characterizer_server.application.characterizer.run_single_test",
        return_value=completed_result,
    ) as workflow:
        application.run_single(f"angle_of_repose_prepared:{preview['preview_id']}")

    assert factory.camera_calls == 1
    assert factory.bundle_calls == 0
    assert workflow.call_args.kwargs["prepared_repose_image"] == b"source-image"
    assert workflow.call_args.kwargs["powder_dispenser"] is None
    assert workflow.call_args.kwargs["balance"] is None
    assert workflow.call_args.kwargs["camera"] is None


def test_prepared_repose_analyzes_and_saves_the_confirmed_image() -> None:
    confirmed_image = b"the exact confirmed image"
    with patch(
        "operation.repose_analysis.analyze_repose",
        return_value=({}, 32.0),
    ) as analyze:
        result = _run_repose(
            camera=None,
            prepared_image_bytes=confirmed_image,
            material_name="Sample",
            timestamp="20261019_120000",
            date_prefix="20261019_",
        )

    analyzed_path = analyze.call_args.args[0]
    assert analyzed_path.name == "20261019_raw_image.png"
    assert result["artifacts"]["repose_raw_image"]["data"] == confirmed_image
    assert result["angle_of_repose"]["angle_deg"] == 32.0
