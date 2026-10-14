from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
STABLE_BALANCE_DEVICE = "/dev/ttyUSB-balance"


def _write_balance_server_fixture(tmp_path: Path) -> tuple[Path, Path, Path]:
    from deploy.configure_balance_server import DRIVER, IMPLEMENTATION, OLD_DRIVER_READ, SERVER_MAIN

    implementation = tmp_path / IMPLEMENTATION
    implementation.parent.mkdir(parents=True)
    implementation.write_text(
        'self._driver = BalanceInterface(port="/dev/ttyUSB0")\n'
    )
    driver = tmp_path / DRIVER
    driver.parent.mkdir(parents=True)
    driver.write_bytes(
        b'import time\n\nimport serial\n\n\nclass BalanceInterface:\n'
        + OLD_DRIVER_READ
        + b'\n    def tare(self) -> None:\n        pass\n'
    )
    server_main = tmp_path / SERVER_MAIN
    server_main.write_text(
        "signal.signal(signal.SIGTERM, lambda *args: server.grpc_server.stop())\n"
    )
    return implementation, driver, server_main


def test_balance_deployment_uses_one_stable_device_name() -> None:
    udev_rule = (ROOT / "deploy/udev/99-powder-flow.rules").read_text()
    service = (ROOT / "deploy/systemd/balance-sila-server.service").read_text()
    configurator = (ROOT / "deploy/configure_balance_server.py").read_text()
    legacy_driver = (ROOT / "hardware_api/balance/balance_api.py").read_text()

    assert 'KERNELS=="3-1"' in udev_rule
    assert 'SYMLINK+="ttyUSB-balance"' in udev_rule
    assert 'ENV{SYSTEMD_ALIAS}+="/dev/sila2/balance"' in udev_rule
    assert "BindsTo=dev-sila2-balance.device" in service
    assert STABLE_BALANCE_DEVICE in configurator
    assert f'DEFAULT_SERIAL_PORT = "{STABLE_BALANCE_DEVICE}"' in legacy_driver


def test_balance_server_configurator_is_idempotent(tmp_path: Path) -> None:
    from deploy.configure_balance_server import configure

    implementation, driver, server_main = _write_balance_server_fixture(tmp_path)

    assert configure(tmp_path, check_only=True).startswith("Ready to configure:")
    assert "/dev/ttyUSB0" in implementation.read_text()
    assert b"BALANCE_STABLE_TOLERANCE_G" not in driver.read_bytes()

    assert configure(tmp_path, check_only=False).startswith("Configured:")
    assert STABLE_BALANCE_DEVICE in implementation.read_text()
    configured_driver = driver.read_text()
    assert "BALANCE_STABLE_POLL_S = 0.5" in configured_driver
    assert "BALANCE_STABLE_DURATION_S = 2.0" in configured_driver
    assert "BALANCE_STABLE_TOLERANCE_G = 0.005" in configured_driver
    assert "BALANCE_STABLE_TIMEOUT_S = 15.0" in configured_driver
    assert "def _read_weight_once" in configured_driver
    assert "time.sleep(settle_time)" not in configured_driver
    assert "server.grpc_server.stop(grace=0)" in server_main.read_text()
    assert configure(tmp_path, check_only=False).startswith("Already configured:")


def test_configured_balance_driver_uses_the_stability_window(tmp_path: Path) -> None:
    from deploy.configure_balance_server import configure

    _, driver, _ = _write_balance_server_fixture(tmp_path)
    configure(tmp_path, check_only=False)

    namespace: dict[str, object] = {}
    exec(driver.read_text(), namespace)
    balance_type = namespace["BalanceInterface"]
    balance = balance_type.__new__(balance_type)
    reads = iter([1.000, 1.020, 1.040, 1.050, 1.052, 1.053, 1.054, 1.055])
    writes: list[bytes] = []
    clock = SimpleNamespace(now=0.0)

    def monotonic() -> float:
        return clock.now

    def sleep(seconds: float) -> None:
        clock.now += seconds

    balance._serial = SimpleNamespace(write=writes.append)
    balance._logger = SimpleNamespace(info=lambda *_args: None, warning=lambda *_args: None)
    balance._read_response = lambda: f"{next(reads):.3f}"
    namespace["time"] = SimpleNamespace(monotonic=monotonic, sleep=sleep)

    assert balance.read_weight() == 1.055
    assert writes == [b"R"] * 8
    assert clock.now == 3.5


def test_configured_balance_driver_preserves_immediate_read_compatibility(
    tmp_path: Path,
) -> None:
    from deploy.configure_balance_server import configure

    _, driver, _ = _write_balance_server_fixture(tmp_path)
    configure(tmp_path, check_only=False)

    namespace: dict[str, object] = {}
    exec(driver.read_text(), namespace)
    balance_type = namespace["BalanceInterface"]
    balance = balance_type.__new__(balance_type)
    writes: list[bytes] = []
    balance._serial = SimpleNamespace(write=writes.append)
    balance._read_response = lambda: "2.345"

    assert balance.read_weight(settle_time=0.0) == 2.345
    assert writes == [b"R"]
