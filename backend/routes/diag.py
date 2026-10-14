"""Muestras del medidor de rendimiento del cliente.

El medidor de la app (`?diag=1`) mide lo único que no se puede medir desde el
servidor: cuánto tarda un toque en el teléfono del mozo, partido en "el hilo
estaba ocupado con otra cosa" y "mi código tardó esto", más las tareas largas y
los FPS de ese dispositivo. El dispositivo lo manda y se lee después.

Es un diagnóstico, no un dato de negocio: se guarda tal cual y solo lo lee quien
está depurando.
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from database import db

router = APIRouter()

# Una muestra es un puñado de números y el registro de los toques del período. Más
# que esto es un cliente roto o alguien probando: se rechaza en vez de guardarlo.
MAX_SAMPLE_BYTES = 16000


def _now():
    return datetime.now(timezone.utc).isoformat()


class DiagSample(BaseModel):
    """Una muestra del medidor. Todo opcional: es un diagnóstico, no un contrato."""

    version: str = Field(default="", max_length=64)
    viewport: Dict[str, Any] = Field(default_factory=dict)
    taps: Dict[str, Any] = Field(default_factory=dict)
    # Lo que el mozo percibe: el toque hasta ver el cambio, y los que no cambiaron
    # nada (`silent`). Es la medida que responde "se demora en aparecer que se tocó".
    visible: Dict[str, Any] = Field(default_factory=dict)
    # El registro de CADA toque del período, en orden: qué se tocó, cuánto tardó y si
    # no hizo nada ('ok' / 'lost' / 'scroll'). Es lo que permite reconstruir lo que
    # el mozo hizo, en vez de mirar promedios.
    taps_log: List[Dict[str, Any]] = Field(default_factory=list)
    # Las peticiones más lentas del período: dice si el costo está en la red.
    requests: List[Dict[str, Any]] = Field(default_factory=list)
    longs: Dict[str, Any] = Field(default_factory=dict)
    fps: Optional[int] = None
    screen: str = Field(default="", max_length=64)


@router.post("/sample")
async def save_sample(data: DiagSample, user: dict = Depends(get_current_user)):
    row = {
        "id": str(uuid.uuid4()),
        "restaurant_id": user.get("restaurant_id"),
        "user_id": user.get("id"),
        "role": user.get("role"),
        "created_at": _now(),
        **data.model_dump(),
    }
    if len(json.dumps(row)) > MAX_SAMPLE_BYTES:
        raise HTTPException(status_code=413, detail="Muestra demasiado grande")
    await db.diag_samples.insert_one(row)
    row.pop("_id", None)
    return {"ok": True, "id": row["id"], "created_at": row["created_at"]}
