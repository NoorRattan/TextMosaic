FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860

WORKDIR /app

COPY backend/requirements-lock.txt /tmp/requirements-lock.txt
RUN pip install --no-cache-dir --requirement /tmp/requirements-lock.txt

COPY backend /app/backend

EXPOSE 7860

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
