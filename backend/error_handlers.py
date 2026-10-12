"""One place that turns domain errors into HTTP responses."""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from billing import BillError


async def bill_error_handler(request: Request, exc: BillError) -> JSONResponse:
    """A broken billing rule is a client error with the rule's own message."""
    return JSONResponse(status_code=400, content={"detail": exc.detail})


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(BillError, bill_error_handler)
