import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from auth import apply_permissions, get_current_user
from database import db
from notify import subscribe, unsubscribe
from branch_access import has_tenantwide_branch_access, validate_user_branch

router = APIRouter()


@router.get("/stream")
async def notification_stream(user: dict = Depends(get_current_user)):
    if not has_tenantwide_branch_access(user):
        await validate_user_branch(user, db.branches)
    queue = subscribe()

    async def gen():
        try:
            yield f"data: {json.dumps({'type': 'hello'})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                rid = event.get("restaurant_id")
                if rid and rid != user.get("restaurant_id"):
                    continue
                current = await db.users.find_one(
                    {"id": user["id"], "restaurant_id": user["restaurant_id"], "status": "active"},
                    {"_id": 0, "password_hash": 0},
                )
                if not current:
                    return
                current = apply_permissions(current)
                current_tenantwide = has_tenantwide_branch_access(current)
                try:
                    current_branch_id = await validate_user_branch(current, db.branches)
                except HTTPException:
                    return
                if not current_tenantwide and event.get("type") in ("order", "table"):
                    if not current_branch_id or event.get("branch_id") != current_branch_id:
                        continue
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            unsubscribe(queue)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
