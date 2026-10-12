FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Keep a single process: realtime events live in memory (see notify.py).
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
