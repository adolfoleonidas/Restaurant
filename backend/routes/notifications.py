import asyncio
import json
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from auth import get_current_user
from notify import subscribe, unsubscribe

router = APIRouter()


@router.get("/stream")
async def notification_stream(user: dict = Depends(get_current_user)):
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
