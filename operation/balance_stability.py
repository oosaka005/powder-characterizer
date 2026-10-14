"""Balance stability policy shared by powder-flow balance adapters.

The policy mirrors the Formulation Cell watched-read behaviour: sample without
an initial dead time, accept the newest value only after the complete trailing
window stays within the configured tolerance, and return the newest available
value if the timeout expires.
"""

from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Callable


BALANCE_STABLE_POLL_S = 0.5
BALANCE_STABLE_DURATION_S = 2.0
BALANCE_STABLE_TOLERANCE_G = 0.005
BALANCE_STABLE_TIMEOUT_S = 15.0


@dataclass(frozen=True)
class SettledWeight:
    mass_g: float
    elapsed_sec: float
    converged: bool
    samples: tuple[tuple[float, float], ...]


def stable_sample_count(stable_duration_s: float, poll_s: float) -> int:
    """Return samples needed to span ``stable_duration_s`` at ``poll_s``."""
    if poll_s <= 0:
        raise ValueError("poll_s must be greater than zero.")
    if stable_duration_s < 0:
        raise ValueError("stable_duration_s must not be negative.")
    return max(2, round(stable_duration_s / poll_s) + 1)


def read_settled_weight(
    read_immediate: Callable[[], float],
    *,
    poll_s: float = BALANCE_STABLE_POLL_S,
    stable_duration_s: float = BALANCE_STABLE_DURATION_S,
    tolerance_g: float = BALANCE_STABLE_TOLERANCE_G,
    timeout_s: float = BALANCE_STABLE_TIMEOUT_S,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> SettledWeight:
    """Read until the trailing window is stable, then accept its newest value."""
    if tolerance_g < 0:
        raise ValueError("tolerance_g must not be negative.")
    if timeout_s < 0:
        raise ValueError("timeout_s must not be negative.")

    window = stable_sample_count(stable_duration_s, poll_s)
    samples: list[tuple[float, float]] = []
    start = monotonic()
    converged = False

    while True:
        elapsed = monotonic() - start
        samples.append((round(elapsed, 3), round(float(read_immediate()), 6)))
        recent = samples[-window:]
        if len(recent) == window:
            masses = [mass for _, mass in recent]
            if max(masses) - min(masses) <= tolerance_g + 1e-9:
                converged = True
                break
            if elapsed >= timeout_s:
                break
        sleep(poll_s)

    return SettledWeight(
        mass_g=samples[-1][1],
        elapsed_sec=samples[-window:][0][0],
        converged=converged,
        samples=tuple(samples),
    )
