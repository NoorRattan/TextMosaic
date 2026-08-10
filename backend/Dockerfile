FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860

WORKDIR /app

COPY backend/requirements-runtime.txt /tmp/requirements-runtime.txt
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.13.0 \
    && pip install --no-cache-dir --requirement /tmp/requirements-runtime.txt

RUN useradd --system --uid 10001 --create-home appuser
COPY --chown=appuser:appuser backend /app/backend

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD python -c "from urllib.request import urlopen; urlopen('http://127.0.0.1:7860/health', timeout=2)"

USER appuser

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
