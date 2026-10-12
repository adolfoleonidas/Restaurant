from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from database import db
from auth import require_roles
from models import ApprovalCreate, ApprovalDecide
from notify import emit_notice
from routes.payments import apply_void_payment, _authorized_order

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("")
async def list_approvals(user: dict = Depends(require_roles(["admin", "cajero"])), status: str = "pending"):
    filt = {"restaurant_id": user["restaurant_id"]}
    if status:
        filt["status"] = status
    if user.get("role") != "admin":
        filt["requested_by"] = user["id"]
    return await db.approvals.find(filt, {"_id": 0}).sort("created_at", -1).to_list(100)


@router.post("")
async def create_approval(data: ApprovalCreate, user: dict = Depends(require_roles(["admin", "cajero", "mozo"]))):
    reason = (data.reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="La solicitud requiere un motivo")
    pay = None
    order = None
    if data.payment_id:
        pay = await db.payments.find_one({"id": data.payment_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0})
        if not pay:
            raise HTTPException(status_code=404, detail="Pago no encontrado")
        if pay.get("status") != "completed":
            raise HTTPException(status_code=400, detail="Ese cobro ya no está vigente")
        existing = await db.approvals.find_one({
            "restaurant_id": user["restaurant_id"],
            "payment_id": data.payment_id,
            "status": "pending",
        })
        if existing:
            return {k: v for k, v in existing.items() if k != "_id"}
        order = await _authorized_order(pay["order_id"], user)
    elif data.order_id:
        order = await _authorized_order(data.order_id, user)

    doc = {
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "kind": data.kind,
        "status": "pending",
        "reason": reason,
        "payment_id": data.payment_id,
        "order_id": (order or {}).get("id") or data.order_id,
        "order_number": (order or {}).get("order_number") or (pay or {}).get("order_number"),
        "amount": data.amount if data.amount is not None else (pay or {}).get("amount"),
        "method": (pay or {}).get("method"),
        "table_id": (order or {}).get("table_id"),
        "requested_by": user["id"],
        "requested_by_name": user.get("full_name"),
        "requested_by_role": user.get("role"),
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.approvals.insert_one(doc)
    emit_notice(user["restaurant_id"], "approval", approval_id=doc["id"], status="pending")
    return {k: v for k, v in doc.items() if k != "_id"}


@router.post("/{approval_id}/decide")
async def decide_approval(approval_id: str, data: ApprovalDecide, user: dict = Depends(require_roles(["admin"]))):
    ap = await db.approvals.find_one({"id": approval_id, "restaurant_id": user["restaurant_id"]})
    if not ap:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")
    if ap.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Esa solicitud ya fue resuelta")
    note = (data.note or "").strip() or None
    patch = {
        "status": "approved" if data.action == "approve" else "rejected",
        "resolved_by": user["id"],
        "resolved_by_name": user.get("full_name"),
        "resolved_at": _now(),
        "note": note,
        "updated_at": _now(),
    }
    if data.action == "approve" and ap.get("kind") in ("void", "refund") and ap.get("payment_id"):
        await apply_void_payment(ap["payment_id"], user, ap.get("reason") or "autorizado", ap.get("kind") or "void")
    await db.approvals.update_one({"id": approval_id}, {"$set": patch})
    emit_notice(user["restaurant_id"], "approval", approval_id=approval_id, status=patch["status"])
    return await db.approvals.find_one({"id": approval_id}, {"_id": 0})
