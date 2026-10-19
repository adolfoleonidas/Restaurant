FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Keep a single process: realtime events live in memory (see notify.py).
#
# Trusted proxy: uvicorn only believes X-Forwarded-* from the peers listed in the
# FORWARDED_ALLOW_IPS environment variable (read natively by uvicorn, so there is
# deliberately no --forwarded-allow-ips flag here). Unset, it trusts only
# 127.0.0.1, i.e. no real proxy: request.client.host stays the socket peer and a
# client-supplied X-Forwarded-For is ignored. That is the safe default for any
# deployment where this image is reachable directly (e.g. a PaaS).
#
# Set FORWARDED_ALLOW_IPS to the proxy's address/subnet (comma separated) when a
# proxy sits in front. docker-compose.yml sets it to "*" for the backend service,
# which is acceptable ONLY there: the backend publishes no port and joins no other
# network, so nginx is the sole peer, and nginx REPLACES X-Forwarded-For with
# $remote_addr (frontend/nginx*.conf). If that port is ever published, or the
# proxy appends to X-Forwarded-For instead of replacing it, narrow the value.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
