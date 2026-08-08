"""FastAPI application entrypoint."""

from fastapi import FastAPI

from app.core.config import get_settings

settings = get_settings()

app = FastAPI(title=settings.app_name)


@app.get("/health")
def read_health() -> dict[str, str]:
    """Report service liveness.

    Returns:
        A status payload confirming the service is up.
    """
    return {"status": "ok"}
