from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STABLE_BALANCE_DEVICE = "/dev/ttyUSB-balance"


def test_balance_deployment_uses_one_stable_device_name() -> None:
    udev_rule = (ROOT / "deploy/udev/99-powder-flow.rules").read_text()
    service = (ROOT / "deploy/systemd/balance-sila-server.service").read_text()
    compatibility_patch = (
        ROOT / "deploy/patches/balance-server-use-stable-device.patch"
    ).read_text()
    legacy_driver = (ROOT / "hardware_api/balance/balance_api.py").read_text()

    assert 'KERNELS=="1-1"' in udev_rule
    assert 'SYMLINK+="ttyUSB-balance"' in udev_rule
    assert 'ENV{SYSTEMD_ALIAS}+="/dev/sila2/balance"' in udev_rule
    assert "BindsTo=dev-sila2-balance.device" in service
    assert STABLE_BALANCE_DEVICE in compatibility_patch
    assert f'DEFAULT_SERIAL_PORT = "{STABLE_BALANCE_DEVICE}"' in legacy_driver
