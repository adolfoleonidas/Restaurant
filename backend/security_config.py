"""Fail closed when a new deployment still has demo secrets or an unsupported topology."""
import os


_DEV_ENVS = {"development", "dev", "test"}
_KNOWN_SECRETS = {
    "",
    "change-this-secret",
    "change-this-secret-in-production-restaurant-app",
    "dev-secret-local-restaurant",
    "dev-only-not-for-production",
}
_DEMO_PASSWORDS = {
    "SEED_ADMIN_PASSWORD": "admin123",
    "SEED_CAJERO_PASSWORD": "cajero123",
    "SEED_MOZO_PASSWORD": "mozo123",
    "SEED_COCINA_PASSWORD": "cocina123",
}
_KNOWN_PASSWORDS = set(_DEMO_PASSWORDS.values())


def known_demo_passwords() -> set:
    """The published demo passwords a real venue must never keep."""
    return set(_KNOWN_PASSWORDS)


def _env(environ):
    return os.environ if environ is None else environ


def is_production(environ=None) -> bool:
    env = _env(environ)
    return (env.get("APP_ENV") or "production").strip().lower() not in _DEV_ENVS


def jwt_secret(environ=None) -> str:
    env = _env(environ)
    secret = (env.get("JWT_SECRET") or "").strip()
    if secret:
        return secret
    if not is_production(env):
        return "dev-only-not-for-production"
    return ""


# Worker-count variables read by uvicorn/gunicorn style launchers.
_WORKER_COUNT_VARS = ("WEB_CONCURRENCY", "UVICORN_WORKERS")


def assert_single_process(environ=None):
    """Realtime (SSE) subscribers live in process memory (see notify.py).

    With several workers an event published in one process never reaches the
    clients connected to another, so screens would silently go stale. Refuse to
    start until a shared broker (e.g. Redis pub/sub) replaces the in-process hub.
    """
    env = _env(environ)
    for name in _WORKER_COUNT_VARS:
        raw = (env.get(name) or "").strip()
        if raw.isdigit() and int(raw) > 1:
            raise RuntimeError(
                f"{name}={raw}: realtime events are kept in process memory, so the backend "
                "must run as a single process. Set it to 1 (see docs/day-one-runbook.md)"
            )


def assert_runtime_config(environ=None):
    env = _env(environ)
    assert_single_process(env)
    if not is_production(env):
        return
    secret = (env.get("JWT_SECRET") or "").strip()
    if secret in _KNOWN_SECRETS or len(secret) < 32:
        raise RuntimeError("JWT_SECRET must be a unique value of at least 32 characters")
    origins = [part.strip() for part in (env.get("CORS_ORIGINS") or "").split(",") if part.strip()]
    if not origins or "*" in origins:
        raise RuntimeError("CORS_ORIGINS must list explicit origins")


def resolve_seed_passwords(environ=None) -> dict:
    env = _env(environ)
    production = is_production(env)
    resolved = {}
    for key, demo in _DEMO_PASSWORDS.items():
        value = (env.get(key) or "").strip()
        if production:
            if not value or value in _KNOWN_PASSWORDS:
                raise RuntimeError(f"{key} must be set to a password that is not a demo default")
            resolved[key] = value
        else:
            resolved[key] = value or demo
    return resolved
