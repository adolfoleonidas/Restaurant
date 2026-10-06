#!/usr/bin/env python3
"""Genera los iconos de la PWA a partir de la marca vectorial de la app.

La marca es la misma que dibuja `frontend/src/components/BrandMark.jsx`
(`BrandSymbol`): un bol con vapor, en un `viewBox` de 48x48. Aquí se replican
sus curvas (líneas y béziers cúbicos) punto a punto, para que el icono del
teléfono sea exactamente la marca de la aplicación y no un dibujo parecido.

Uso (desde `frontend/`):

    python scripts/generate-icons.py

Escribe en `public/icons/` y en `public/`:

    icon-192.png, icon-512.png                  -> manifest, purpose "any"
    icon-maskable-192.png, icon-maskable-512.png -> manifest, purpose "maskable"
    apple-touch-icon-180.png                    -> iOS (sin transparencia)
    favicon.ico                                 -> 16/32/48 px

Por qué un script y no los PNG a mano: si la marca cambia, los iconos se
regeneran con un comando en vez de con un editor de imágenes. Requiere Pillow.
"""

from colorsys import hls_to_rgb
from pathlib import Path

from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parent.parent / "public"
ICONS = PUBLIC / "icons"

# Marca en el viewBox original de `BrandSymbol` (48x48).
VIEWBOX = 48.0
BOWL_FILL = [
    ("M", (11, 29)),
    ("L", (37, 29)),
    ("C", (36.2, 36.1), (31.1, 40.0), (24.0, 40.0)),
    ("C", (16.9, 40.0), (11.8, 36.1), (11.0, 29.0)),
]
WAVE_STROKE = [
    ("M", (8.0, 27.0)),
    ("C", (12.0, 24.8), (16.0, 24.8), (20.0, 27.0)),
    ("C", (24.0, 29.2), (28.0, 29.2), (32.0, 27.0)),
    ("C", (36.0, 24.8), (38.0, 24.8), (40.0, 25.6)),
]
# El vapor son tres trazos idénticos desplazados: el mismo par de béziers.
STEAM = [
    (17.0, 21.0, (-2.0, -2.2), (-1.5, -4.4), (0.2, -6.3), (1.5, -1.7), (1.6, -3.4), (0.2, -5.2)),
    (25.0, 20.0, (-2.0, -2.3), (-1.5, -4.7), (0.2, -6.7), (1.5, -1.8), (1.7, -3.6), (0.2, -5.4)),
    (33.0, 21.0, (-2.0, -2.2), (-1.5, -4.4), (0.2, -6.3), (1.5, -1.7), (1.6, -3.4), (0.2, -5.2)),
]

WAVE_WIDTH = 2.5
STEAM_WIDTH = 2.4


def brand_blue():
    """--primary de index.css: hsl(220 75% 45%)."""
    red, green, blue = hls_to_rgb(220 / 360.0, 0.45, 0.75)
    return (round(red * 255), round(green * 255), round(blue * 255), 255)


def cubic_points(p0, c1, c2, p1, steps=28):
    """Muestrea un bézier cúbico: Pillow no dibuja curvas, así que se aproximan
    con suficientes segmentos como para que a tamaño de icono no se note."""
    points = []
    for index in range(steps + 1):
        t = index / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t**3 * p1[0]
        y = u**3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t**3 * p1[1]
        points.append((x, y))
    return points


def path_points(commands):
    points = []
    current = (0.0, 0.0)
    for command in commands:
        if command[0] == "M":
            current = command[1]
            points.append([current])
        elif command[0] == "L":
            current = command[1]
            points[-1].append(current)
        elif command[0] == "C":
            end = command[3]
            points[-1].extend(cubic_points(current, command[1], command[2], end))
            current = end
    return points


def draw_mark(canvas_size, mark_ratio, background, supersample=4):
    """Dibuja la marca centrada.

    `mark_ratio` es la fracción del lienzo que ocupa el viewBox 48x48. Para
    iconos "any" conviene ~0,62; para maskable ~0,5 (dentro del círculo seguro
    del 80 %); para iOS ~0,66.
    """
    size = canvas_size * supersample
    image = Image.new("RGBA", (size, size), background)
    draw = ImageDraw.Draw(image)

    mark_size = size * mark_ratio
    offset = (size - mark_size) / 2.0
    scale = mark_size / VIEWBOX

    def to_px(point):
        return (offset + point[0] * scale, offset + point[1] * scale)

    # Bol (relleno).
    for polygon in path_points(BOWL_FILL):
        draw.polygon([to_px(point) for point in polygon], fill=(255, 255, 255, 255))

    white = (255, 255, 255, 255)

    # Onda del borde del bol.
    for polygon in path_points(WAVE_STROKE):
        draw.line([to_px(point) for point in polygon], fill=white,
                  width=max(1, round(WAVE_WIDTH * scale)), joint="curve")
        for point in (polygon[0], polygon[-1]):
            radius = WAVE_WIDTH * scale / 2.0
            cx, cy = to_px(point)
            draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=white)

    # Vapor.
    for start_x, start_y, c1, c2, end1, c3, c4, end2 in STEAM:
        first = cubic_points((start_x, start_y),
                             (start_x + c1[0], start_y + c1[1]),
                             (start_x + c2[0], start_y + c2[1]),
                             (start_x + end1[0], start_y + end1[1]))
        second = cubic_points((start_x + end1[0], start_y + end1[1]),
                              (start_x + end1[0] + c3[0], start_y + end1[1] + c3[1]),
                              (start_x + end1[0] + c4[0], start_y + end1[1] + c4[1]),
                              (start_x + end1[0] + end2[0], start_y + end1[1] + end2[1]))
        stroke_points = first + second
        draw.line([to_px(point) for point in stroke_points], fill=white,
                  width=max(1, round(STEAM_WIDTH * scale)), joint="curve")
        for point in (stroke_points[0], stroke_points[-1]):
            radius = STEAM_WIDTH * scale / 2.0
            cx, cy = to_px(point)
            draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=white)

    return image.resize((canvas_size, canvas_size), Image.LANCZOS)


def rounded_tile(canvas_size, background, radius_ratio=0.22, supersample=4):
    """Cuadrado con esquinas redondeadas y el resto transparente."""
    size = canvas_size * supersample
    radius = size * radius_ratio
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    tile = Image.new("RGBA", (size, size), background)
    tile.putalpha(mask)
    return tile.resize((canvas_size, canvas_size), Image.LANCZOS)


def compose(canvas_size, background, mark_ratio, rounded):
    """Fondo (redondeado o completo) con la marca blanca encima."""
    if rounded:
        base = rounded_tile(canvas_size, background)
    else:
        base = Image.new("RGBA", (canvas_size, canvas_size), background)
    base.alpha_composite(draw_mark(canvas_size, mark_ratio, (0, 0, 0, 0)))
    return base


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    blue = brand_blue()

    # purpose "any": cuadrado redondeado, marca al 62 %.
    for size in (192, 512):
        compose(size, blue, 0.62, True).save(ICONS / f"icon-{size}.png")

    # purpose "maskable": lienzo completo (sin transparencia) y marca al 50 %,
    # dentro del círculo seguro del 80 % que recorta Android.
    for size in (192, 512):
        compose(size, blue, 0.50, False).save(ICONS / f"icon-maskable-{size}.png")

    # iOS aplica su propia máscara: cuadrado completo, sin alfa.
    compose(180, blue, 0.66, False).convert("RGB").save(ICONS / "apple-touch-icon-180.png")

    # favicon: la marca sola, sobre el azul de marca, en los tres tamaños
    # clásicos.
    favicon_sizes = (16, 32, 48)
    frames = [compose(size, blue, 0.72, True).convert("RGBA") for size in favicon_sizes]
    frames[-1].save(PUBLIC / "favicon.ico", sizes=[(s, s) for s in favicon_sizes])

    for path in sorted(list(ICONS.glob("*.png")) + [PUBLIC / "favicon.ico"]):
        print(f"{path.relative_to(PUBLIC.parent)}  {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
