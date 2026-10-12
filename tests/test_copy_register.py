"""API messages use the same register as the UI: tuteo, never voseo or usted."""
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"

VOSEO = [
    "Abrí", "Anulá", "anulalos", "Cerrá", "Elegí", "Hacé", "Mirá", "Probá", "Revisá", "Usá", "Volvé",
    "reintentá", "revisá", "volvé", "elegí", "querés", "podés", "tenés",
]
USTED = ["Seleccione", "Inténtelo", "Vuelva", "Adjunte", "Recargue"]
LETTER = "A-Za-zÁÉÍÓÚáéíóúñÑ"
PATTERN = re.compile(rf"(?<![{LETTER}0-9_])(?:{'|'.join(VOSEO + USTED)})(?![{LETTER}0-9_])")


def test_api_messages_use_tuteo():
    offenders = []
    for path in BACKEND.rglob("*.py"):
        if "tests" in path.parts or path.name.startswith("test_"):
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if line.lstrip().startswith("#"):
                continue
            if PATTERN.search(line):
                offenders.append(f"{path.relative_to(BACKEND)}:{number} {line.strip()[:90]}")
    assert offenders == []
