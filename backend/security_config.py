"""Fail closed when a new deployment still has demo secrets."""
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


def assert_runtime_config(environ=None):
    env = _env(environ)
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
