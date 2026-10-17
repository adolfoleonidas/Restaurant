FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Keep a single process: realtime events live in memory (see notify.py).
#
# Trusted proxy: by default uvicorn only believes X-Forwarded-* from 127.0.0.1,
# so behind nginx request.client.host was the nginx container for everyone (one
# shared login-lockout/rate-limit key). "*" is acceptable here ONLY because the
# backend is reachable exclusively through nginx: docker-compose.yml publishes no
# port for it and it joins no other network. With "*" uvicorn takes the FIRST
# X-Forwarded-For value, which is safe because nginx REPLACES the header with
# $remote_addr (frontend/nginx*.conf). If this port is ever published, or the
# image runs behind a proxy that appends to X-Forwarded-For, replace "*" with the
# proxy's address/subnet.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
