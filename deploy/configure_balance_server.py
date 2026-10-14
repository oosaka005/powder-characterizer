"""Configure the separately deployed Balance server to use the udev device."""

from __future__ import annotations

import argparse
from pathlib import Path


DEFAULT_REPOSITORY = Path("/home/sdl-5/balance_sila_server")
IMPLEMENTATION = Path("balance_server/feature_implementations/balance_impl.py")
OLD = b'BalanceInterface(port="/dev/ttyUSB0")'
NEW = b'BalanceInterface(port="/dev/ttyUSB-balance")'


def configure(repository: Path, *, check_only: bool) -> str:
    implementation = repository / IMPLEMENTATION
    source = implementation.read_bytes()

    old_count = source.count(OLD)
    new_count = source.count(NEW)
    if old_count == 0 and new_count == 1:
        return f"Already configured: {implementation}"
    if old_count != 1 or new_count != 0:
        raise RuntimeError(
            "Expected exactly one BalanceInterface constructor using "
            f"/dev/ttyUSB0 in {implementation}; found old={old_count}, "
            f"new={new_count}. Inspect the Balance server before editing it."
        )
    if check_only:
        return f"Ready to configure: {implementation}"

    implementation.write_bytes(source.replace(OLD, NEW, 1))
    return f"Configured: {implementation}"


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
