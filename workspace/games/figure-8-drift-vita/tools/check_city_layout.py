"""Fast structural checks for the authoritative city data in src/main.cpp."""

from __future__ import annotations

import math

import city_preview as city


def samples() -> list[tuple[float, float, float, str]]:
    result: list[tuple[float, float, float, str]] = []
    for center in city.BASE_ROADS:
        half = 11.0 if abs(center) < 1 else (8.0 if abs(center) < 80 else 6.5)
        for index in range(163):
            position = -162 + index * 2
            result.extend(((center, position, half, "base-v"), (position, center, half, "base-h")))
    for index, (x0, z0, x1, z1, half) in enumerate(city.ROADS):
        count = max(2, int(math.hypot(x1 - x0, z1 - z0) / 2) + 1)
        for sample in range(count + 1):
            t = sample / count
            result.append((x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, half, f"segment-{index}"))
    for index, (points, half) in enumerate(city.CURVES):
        count = (len(points) - 1) * 20
        for sample in range(count + 1):
            x, z = city.catmull_open(points, sample / 20)
            result.append((x, z, half, f"curve-{index}"))
    park = city.tuples(city.SOURCE_TEXT, "PARK_ROAD_CONTROL", 2)
    for sample in range((len(park) - 1) * 20 + 1):
        x, z = city.catmull_open(park, sample / 20)
        result.append((x, z, 6.5, "park"))
    return result


def conflicts(
    objects: list[tuple[float, ...]],
    roads: list[tuple[float, float, float, str]],
    margin: float,
) -> list[str]:
    failures = []
    for index, item in enumerate(objects):
        x, z, width, depth = item[:4]
        clearance, road_name = min(
            (
                math.hypot(max(abs(px - x) - width / 2, 0), max(abs(pz - z) - depth / 2, 0)) - half,
                name,
            )
            for px, pz, half, name in roads
        )
        if clearance < margin:
            failures.append(
                f"#{index} at ({x:.1f}, {z:.1f}) has {clearance:.2f} m clearance from {road_name}"
            )
    return failures


def main() -> int:
    roads = samples()
    failures = [
        *(f"building {message}" for message in conflicts(city.BUILDINGS, roads, 1.5)),
        *(f"industrial obstacle {message}" for message in conflicts(city.INDUSTRIAL_OBSTACLES, roads, 1.0)),
    ]
    if failures:
        print("City layout check failed:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print(
        f"City layout OK: {len(city.BUILDINGS)} buildings and "
        f"{len(city.INDUSTRIAL_OBSTACLES)} industrial obstacles clear every ground road."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
