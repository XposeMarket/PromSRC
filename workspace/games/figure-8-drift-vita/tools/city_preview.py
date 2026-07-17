"""Native Windows preview for Figure 8 Drift's city layout.

The preview parses the authoritative map arrays from src/main.cpp. It is not a
Vita emulator; it is a fast geometry/camera sandbox for validating roads,
buildings, hills, ponds, ramps, and bridge clearance before producing a VPK.
"""

from __future__ import annotations

import argparse
import math
import re
import time
from pathlib import Path

import glfw
from OpenGL import GL as gl
from OpenGL import GLU as glu
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src" / "main.cpp"


def array_body(source: str, name: str) -> str:
    match = re.search(rf"{name}\[\]\s*=\s*\{{(.*?)\}};", source, re.S)
    if not match:
        raise RuntimeError(f"Could not find {name} in {SOURCE}")
    return match.group(1)


def tuples(source: str, name: str, width: int) -> list[tuple[float, ...]]:
    values = []
    for body in re.findall(r"\{([^{}]+)\}", array_body(source, name)):
        numbers = [float(v.rstrip("f")) for v in re.findall(r"-?(?:\d+(?:\.\d*)?|\.\d+)f?", body)]
        if len(numbers) >= width:
            values.append(tuple(numbers[:width]))
    return values


SOURCE_TEXT = SOURCE.read_text(encoding="utf-8")
BUILDINGS = tuples(SOURCE_TEXT, "CITY_BUILDINGS", 8)
INDUSTRIAL_OBSTACLES = tuples(SOURCE_TEXT, "INDUSTRIAL_OBSTACLES", 8)
PARKED_CARS = tuples(SOURCE_TEXT, "PARKED_CARS", 6)
ROADS = tuples(SOURCE_TEXT, "CITY_EXTENDED_ROADS", 5)
HIGHWAY = tuples(SOURCE_TEXT, "HIGHWAY_CONTROL", 2)
RAMPS = tuples(SOURCE_TEXT, "HIGHWAY_RAMPS", 4)
CURVES = [
    (tuples(SOURCE_TEXT, "WEST_CURVE_CONTROL", 2), 6.0),
    (tuples(SOURCE_TEXT, "EAST_CURVE_CONTROL", 2), 7.0),
    (tuples(SOURCE_TEXT, "HILL_CURVE_CONTROL", 2), 6.0),
    (tuples(SOURCE_TEXT, "EAST_HILL_CURVE_CONTROL", 2), 6.0),
    (tuples(SOURCE_TEXT, "SOUTH_CURVE_CONTROL", 2), 8.0),
]
BASE_ROADS = [
    float(v.rstrip("f"))
    for v in re.findall(
        r"-?(?:\d+(?:\.\d*)?|\.\d+)f?", array_body(SOURCE_TEXT, "CITY_ROADS")
    )
]


def catmull(points: list[tuple[float, float]], position: float) -> tuple[float, float]:
    count = len(points)
    segment = math.floor(position) % count
    t = position - math.floor(position)
    p0, p1 = points[(segment - 1) % count], points[segment]
    p2, p3 = points[(segment + 1) % count], points[(segment + 2) % count]
    t2, t3 = t * t, t * t * t
    return (
        0.5
        * (
            2 * p1[0]
            + (-p0[0] + p2[0]) * t
            + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
            + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
        ),
        0.5
        * (
            2 * p1[1]
            + (-p0[1] + p2[1]) * t
            + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
            + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
        ),
    )


def catmull_open(points: list[tuple[float, float]], position: float) -> tuple[float, float]:
    maximum = len(points) - 1
    position = max(0.0, min(position, maximum))
    segment = min(math.floor(position), len(points) - 2)
    t = 1.0 if position >= maximum else position - segment
    p0, p1 = points[max(0, segment - 1)], points[segment]
    p2, p3 = points[segment + 1], points[min(len(points) - 1, segment + 2)]
    t2, t3 = t * t, t * t * t
    return (
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    )


def vertex(x: float, y: float, z: float) -> None:
    gl.glVertex3f(x, y, z)


def color(r: float, g: float, b: float) -> None:
    gl.glColor3f(r, g, b)


def quad_strip_segment(x0: float, z0: float, x1: float, z1: float, half: float, y0: float, y1: float) -> None:
    dx, dz = x1 - x0, z1 - z0
    length = max(math.hypot(dx, dz), 0.001)
    nx, nz = -dz / length * half, dx / length * half
    vertex(x0 + nx, y0, z0 + nz)
    vertex(x0 - nx, y0, z0 - nz)
    vertex(x1 - nx, y1, z1 - nz)
    vertex(x1 + nx, y1, z1 + nz)


def cube(x: float, y: float, z: float, sx: float, sy: float, sz: float, rgb: tuple[float, float, float]) -> None:
    color(*rgb)
    x0, x1, y0, y1, z0, z1 = x - sx / 2, x + sx / 2, y - sy / 2, y + sy / 2, z - sz / 2, z + sz / 2
    gl.glBegin(gl.GL_QUADS)
    for face in (
        ((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)),
        ((x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)),
        ((x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)),
        ((x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)),
        ((x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)),
    ):
        for point in face:
            vertex(*point)
    gl.glEnd()


class Preview:
    def __init__(self, invisible: bool = False, view: str = "overview"):
        if not glfw.init():
            raise RuntimeError("GLFW could not initialize")
        glfw.window_hint(glfw.CONTEXT_VERSION_MAJOR, 2)
        glfw.window_hint(glfw.CONTEXT_VERSION_MINOR, 1)
        glfw.window_hint(glfw.VISIBLE, glfw.FALSE if invisible else glfw.TRUE)
        self.window = glfw.create_window(1280, 720, "Figure 8 City Preview", None, None)
        if not self.window:
            glfw.terminate()
            raise RuntimeError("Could not create an OpenGL 2.1 preview window")
        glfw.make_context_current(self.window)
        glfw.swap_interval(1)
        presets = {
            "overview": (-70.0, 150.0, 390.0, math.pi, -0.31),
            "underpass": (-105.0, 4.2, -118.0, math.pi, 0.02),
            "roads": (-10.0, 95.0, 245.0, math.pi, -0.48),
            "topdown": (15.0, 620.0, 20.0, math.pi, -1.48),
        }
        self.x, self.y, self.z, self.yaw, self.pitch = presets[view]
        gl.glEnable(gl.GL_DEPTH_TEST)
        gl.glClearColor(0.39, 0.60, 0.78, 1.0)

    def update(self, dt: float) -> None:
        speed = 170.0 * dt
        down = lambda value: glfw.get_key(self.window, value) == glfw.PRESS
        if down(glfw.KEY_LEFT_SHIFT):
            speed *= 2.4
        forward = (math.sin(self.yaw), math.cos(self.yaw))
        right = (math.cos(self.yaw), -math.sin(self.yaw))
        if down(glfw.KEY_W):
            self.x += forward[0] * speed
            self.z += forward[1] * speed
        if down(glfw.KEY_S):
            self.x -= forward[0] * speed
            self.z -= forward[1] * speed
        if down(glfw.KEY_A):
            self.x -= right[0] * speed
            self.z -= right[1] * speed
        if down(glfw.KEY_D):
            self.x += right[0] * speed
            self.z += right[1] * speed
        if down(glfw.KEY_Q):
            self.y += speed
        if down(glfw.KEY_E):
            self.y -= speed
        if down(glfw.KEY_LEFT):
            self.yaw -= 1.35 * dt
        if down(glfw.KEY_RIGHT):
            self.yaw += 1.35 * dt
        if down(glfw.KEY_UP):
            self.pitch = min(0.15, self.pitch + 1.1 * dt)
        if down(glfw.KEY_DOWN):
            self.pitch = max(-1.25, self.pitch - 1.1 * dt)
        if down(glfw.KEY_ESCAPE):
            glfw.set_window_should_close(self.window, True)

    def draw(self) -> None:
        width, height = glfw.get_framebuffer_size(self.window)
        gl.glClear(gl.GL_COLOR_BUFFER_BIT | gl.GL_DEPTH_BUFFER_BIT)
        gl.glViewport(0, 0, width, height)
        gl.glMatrixMode(gl.GL_PROJECTION)
        gl.glLoadIdentity()
        glu.gluPerspective(58.0, width / max(height, 1), 0.2, 1800.0)
        gl.glMatrixMode(gl.GL_MODELVIEW)
        gl.glLoadIdentity()
        dx = math.sin(self.yaw) * math.cos(self.pitch)
        dy = math.sin(self.pitch)
        dz = math.cos(self.yaw) * math.cos(self.pitch)
        glu.gluLookAt(self.x, self.y, self.z, self.x + dx, self.y + dy, self.z + dz, 0, 1, 0)

        color(0.18, 0.44, 0.15)
        gl.glBegin(gl.GL_QUADS)
        vertex(-430, 0, -320)
        vertex(560, 0, -320)
        vertex(560, 0, 320)
        vertex(-430, 0, 320)
        gl.glEnd()

        # All sidewalks first, then asphalt, matching the Vita draw order.
        for extra, rgb, y in ((2.3, (0.55, 0.55, 0.53), 0.03), (0.0, (0.20, 0.21, 0.22), 0.06)):
            color(*rgb)
            gl.glBegin(gl.GL_QUADS)
            for center in BASE_ROADS:
                half = 11.0 if abs(center) < 1 else (8.0 if abs(center) < 80 else 6.5)
                quad_strip_segment(center, -162, center, 162, half + extra, y, y)
                quad_strip_segment(-162, center, 162, center, half + extra, y, y)
            for x0, z0, x1, z1, half in ROADS:
                quad_strip_segment(x0, z0, x1, z1, half + extra, y, y)
            for points, half in CURVES:
                samples = (len(points) - 1) * 10
                for sample in range(samples):
                    a = catmull_open(points, sample / 10)
                    b = catmull_open(points, (sample + 1) / 10)
                    quad_strip_segment(a[0], a[1], b[0], b[1], half + extra, y, y)
            gl.glEnd()

        # Elevated loop.
        color(0.22, 0.23, 0.24)
        gl.glBegin(gl.GL_QUADS)
        samples = len(HIGHWAY) * 10
        for i in range(samples):
            a, b = catmull(HIGHWAY, i / 10), catmull(HIGHWAY, (i + 1) / 10)
            quad_strip_segment(a[0], a[1], b[0], b[1], 10.0, 10.0, 10.0)
        gl.glEnd()
        for i in range(0, samples, 7):
            p = catmull(HIGHWAY, i / 10)
            cube(p[0], 5.0, p[1], 1.4, 10.0, 1.4, (0.46, 0.47, 0.48))

        color(0.24, 0.25, 0.26)
        gl.glBegin(gl.GL_QUADS)
        for x0, z0, x1, z1 in RAMPS:
            for i in range(12):
                quad_strip_segment(
                    x0 + (x1 - x0) * i / 12,
                    z0 + (z1 - z0) * i / 12,
                    x0 + (x1 - x0) * (i + 1) / 12,
                    z0 + (z1 - z0) * (i + 1) / 12,
                    8.0,
                    10.0 * i / 12,
                    10.0 * (i + 1) / 12,
                )
        gl.glEnd()

        for x, z, width, depth, height, r, g, b in BUILDINGS:
            cube(x, height / 2, z, width, height, depth, (min(r * 1.1, 1), min(g * 1.1, 1), min(b * 1.1, 1)))
        for x, z, width, depth, height, r, g, b in INDUSTRIAL_OBSTACLES:
            cube(x, height / 2, z, width, height, depth, (r, g, b))
        for x, z, yaw, r, g, b in PARKED_CARS:
            width, depth = (1.75, 3.45) if yaw in (0.0, 180.0) else (3.45, 1.75)
            cube(x, 0.45, z, width, 0.9, depth, (r, g, b))

    def save(self, path: Path) -> None:
        width, height = glfw.get_framebuffer_size(self.window)
        pixels = gl.glReadPixels(0, 0, width, height, gl.GL_RGB, gl.GL_UNSIGNED_BYTE)
        Image.frombytes("RGB", (width, height), pixels).transpose(Image.Transpose.FLIP_TOP_BOTTOM).save(path)

    def close(self) -> None:
        glfw.destroy_window(self.window)
        glfw.terminate()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", type=Path, help="Render one invisible frame to a PNG and exit.")
    parser.add_argument("--view", choices=("overview", "underpass", "roads", "topdown"), default="overview")
    args = parser.parse_args()
    window = Preview(invisible=bool(args.snapshot), view=args.view)
    if args.snapshot:
        window.draw()
        window.save(args.snapshot)
        window.close()
        return
    previous = time.perf_counter()
    while not glfw.window_should_close(window.window):
        now = time.perf_counter()
        window.update(min(now - previous, 0.05))
        previous = now
        window.draw()
        glfw.swap_buffers(window.window)
        glfw.poll_events()
    window.close()


if __name__ == "__main__":
    main()
