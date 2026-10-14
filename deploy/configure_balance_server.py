"""Configure the separately deployed Balance server to use the udev device."""

from __future__ import annotations

import argparse
from pathlib import Path


DEFAULT_REPOSITORY = Path("/home/sdl-5/balance_sila_server")
IMPLEMENTATION = Path("balance_server/feature_implementations/balance_impl.py")
DRIVER = Path("balance_server/drivers/balance_interface.py")
OLD = b'BalanceInterface(port="/dev/ttyUSB0")'
NEW = b'BalanceInterface(port="/dev/ttyUSB-balance")'

STABILITY_CONSTANTS = b'''\
BALANCE_STABLE_POLL_S = 0.5
BALANCE_STABLE_DURATION_S = 2.0
BALANCE_STABLE_TOLERANCE_G = 0.005
BALANCE_STABLE_TIMEOUT_S = 15.0
BALANCE_STABLE_SAMPLE_COUNT = (
    int(BALANCE_STABLE_DURATION_S / BALANCE_STABLE_POLL_S) + 1
)
'''

OLD_DRIVER_READ = b'''\
    def read_weight(self, settle_time: float = 2.0) -> float:
        """Read weight after optional settling delay. Returns value in grams."""
        if settle_time > 0:
            time.sleep(settle_time)
        self._serial.write(b"R")
        raw = self._read_response()
        value = float(raw.replace("\\r", "").replace("\\n", "").strip())
        self.current_mass_g = value
        return value
'''

STABLE_DRIVER_READ = b'''\
    def _read_weight_once(self) -> float:
        """Read one weight immediately without applying a settling policy."""
        self._serial.write(b"R")
        raw = self._read_response()
        value = float(raw.replace("\\r", "").replace("\\n", "").strip())
        self.current_mass_g = value
        return value

    def read_weight(self, settle_time: float = 2.0) -> float:
        """Return the newest value after the balance holds a stable window.

        ``settle_time <= 0`` remains available for a single immediate read.
        Sampling otherwise starts immediately and mirrors the Formulation Cell
        stability policy instead of sleeping for a fixed two seconds.
        """
        if settle_time <= 0:
            return self._read_weight_once()

        samples: list[tuple[float, float]] = []
        start = time.monotonic()
        converged = False
        while True:
            elapsed = time.monotonic() - start
            samples.append(
                (round(elapsed, 3), round(float(self._read_weight_once()), 6))
            )
            recent = samples[-BALANCE_STABLE_SAMPLE_COUNT:]
            if len(recent) == BALANCE_STABLE_SAMPLE_COUNT:
                masses = [mass for _, mass in recent]
                if max(masses) - min(masses) <= BALANCE_STABLE_TOLERANCE_G + 1e-9:
                    converged = True
                    break
                if elapsed >= BALANCE_STABLE_TIMEOUT_S:
                    break
            time.sleep(BALANCE_STABLE_POLL_S)

        if converged:
            self._logger.info(
                "Balance: settled at %.4f g after %.1fs (%d samples)",
                samples[-1][1],
                samples[-BALANCE_STABLE_SAMPLE_COUNT][0],
                len(samples),
            )
        else:
            self._logger.warning(
                "Balance: did not settle within %.1fs; using %.4f g",
                BALANCE_STABLE_TIMEOUT_S,
                samples[-1][1],
            )
        return samples[-1][1]
'''


def _configured_implementation(source: bytes, path: Path) -> tuple[bytes, bool]:
    old_count = source.count(OLD)
    new_count = source.count(NEW)
    if old_count == 0 and new_count == 1:
        return source, False
    if old_count != 1 or new_count != 0:
        raise RuntimeError(
            "Expected exactly one BalanceInterface constructor using "
            f"/dev/ttyUSB0 in {path}; found old={old_count}, "
            f"new={new_count}. Inspect the Balance server before editing it."
        )
    return source.replace(OLD, NEW, 1), True


def _configured_driver(source: bytes, path: Path) -> tuple[bytes, bool]:
    stable_count = source.count(STABLE_DRIVER_READ)
    constants_count = source.count(STABILITY_CONSTANTS)
    if stable_count == 1 and constants_count == 1:
        return source, False
    if stable_count != 0 or constants_count != 0:
        raise RuntimeError(
            f"Partial balance stability configuration found in {path}. "
            "Inspect the Balance server before editing it."
        )
    old_count = source.count(OLD_DRIVER_READ)
    timeout_marker = b"DEFAULT_TIMEOUT = 1.0\n"
    if old_count != 1 or source.count(timeout_marker) != 1:
        raise RuntimeError(
            "Expected the verified legacy read_weight implementation and one "
            f"DEFAULT_TIMEOUT marker in {path}; found read_weight={old_count}, "
            f"timeout_marker={source.count(timeout_marker)}. Inspect the Balance "
            "server before editing it."
        )
    configured = source.replace(
        timeout_marker,
        timeout_marker + b"\n" + STABILITY_CONSTANTS,
        1,
    ).replace(OLD_DRIVER_READ, STABLE_DRIVER_READ, 1)
    return configured, True


def configure(repository: Path, *, check_only: bool) -> str:
    implementation = repository / IMPLEMENTATION
    driver = repository / DRIVER
    configured_implementation, implementation_changed = _configured_implementation(
        implementation.read_bytes(), implementation
    )
    configured_driver, driver_changed = _configured_driver(driver.read_bytes(), driver)
    changed = implementation_changed or driver_changed
    if not changed:
        return f"Already configured: {implementation}; {driver}"
    if check_only:
        return f"Ready to configure: {implementation}; {driver}"

    if implementation_changed:
        implementation.write_bytes(configured_implementation)
    if driver_changed:
        driver.write_bytes(configured_driver)
    return f"Configured: {implementation}; {driver}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "repository",
        nargs="?",
        type=Path,
        default=DEFAULT_REPOSITORY,
        help=f"Balance server repository (default: {DEFAULT_REPOSITORY})",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate the expected source without changing it",
    )
    arguments = parser.parse_args()
    print(configure(arguments.repository, check_only=arguments.check))


if __name__ == "__main__":
    main()
