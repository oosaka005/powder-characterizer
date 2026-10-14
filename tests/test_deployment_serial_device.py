from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STABLE_BALANCE_DEVICE = "/dev/ttyUSB-balance"


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
    from deploy.configure_balance_server import IMPLEMENTATION, configure

    implementation = tmp_path / IMPLEMENTATION
    implementation.parent.mkdir(parents=True)
    implementation.write_text(
        'self._driver = BalanceInterface(port="/dev/ttyUSB0")\n'
    )

    assert configure(tmp_path, check_only=True).startswith("Ready to configure:")
    assert "/dev/ttyUSB0" in implementation.read_text()

    assert configure(tmp_path, check_only=False).startswith("Configured:")
    assert STABLE_BALANCE_DEVICE in implementation.read_text()
    assert configure(tmp_path, check_only=False).startswith("Already configured:")
