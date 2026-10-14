from __future__ import annotations

from collections import deque

import pytest

from operation.balance_stability import read_settled_weight, stable_sample_count


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


def _read(values: list[float]):
    remaining = deque(values)
    last = values[-1]

    def read() -> float:
        nonlocal last
        if remaining:
            last = remaining.popleft()
        return last

    return read


def test_stable_sample_count_spans_the_full_duration() -> None:
    assert stable_sample_count(2.0, 0.5) == 5
    assert stable_sample_count(3.0, 0.5) == 7


def test_quiet_balance_is_accepted_after_one_complete_window() -> None:
    clock = FakeClock()

    result = read_settled_weight(
        _read([1.000, 1.002, 1.004, 1.003, 1.005]),
        monotonic=clock.monotonic,
        sleep=clock.sleep,
    )

    assert result.converged is True
    assert result.mass_g == pytest.approx(1.005)
    assert len(result.samples) == 5
    assert clock.now == pytest.approx(2.0)


def test_drifting_balance_waits_for_a_stable_trailing_window() -> None:
    clock = FakeClock()

    result = read_settled_weight(
        _read([1.000, 1.020, 1.040, 1.050, 1.052, 1.053, 1.054, 1.055]),
        monotonic=clock.monotonic,
        sleep=clock.sleep,
    )

    assert result.converged is True
    assert result.mass_g == pytest.approx(1.055)
    assert len(result.samples) == 8
    assert clock.now == pytest.approx(3.5)


def test_timeout_returns_the_newest_available_value() -> None:
    clock = FakeClock()

    result = read_settled_weight(
        _read([0.0, 0.1, 0.2, 0.3, 0.4, 0.5]),
        stable_duration_s=1.0,
        timeout_s=2.0,
        monotonic=clock.monotonic,
        sleep=clock.sleep,
    )

    assert result.converged is False
    assert result.mass_g == pytest.approx(0.4)
    assert clock.now == pytest.approx(2.0)


def test_sampling_starts_without_an_initial_dead_time() -> None:
    clock = FakeClock()
    call_times: list[float] = []

    def read() -> float:
        call_times.append(clock.now)
        return 2.0

    read_settled_weight(read, monotonic=clock.monotonic, sleep=clock.sleep)

    assert call_times == pytest.approx([0.0, 0.5, 1.0, 1.5, 2.0])
