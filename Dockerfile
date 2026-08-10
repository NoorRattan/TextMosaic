FROM node:24-alpine AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./
RUN npm run build


FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends --yes nginx \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements-runtime.txt /tmp/requirements-runtime.txt
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.13.0 \
    && pip install --no-cache-dir --requirement /tmp/requirements-runtime.txt

RUN useradd --system --uid 1000 --create-home appuser \
    && mkdir --parents /var/cache/nginx /var/log/nginx \
    && chown --recursive appuser:appuser /var/cache/nginx /var/log/nginx

COPY --chown=appuser:appuser backend /app/backend
COPY --from=frontend-builder --chown=appuser:appuser /frontend/dist /app/frontend-dist
COPY --chown=appuser:appuser hf-space/nginx.conf /etc/nginx/nginx.conf
COPY --chown=appuser:appuser hf-space/start.sh /app/start.sh
RUN chmod 755 /app/start.sh

USER appuser

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD python -c "from urllib.request import urlopen; urlopen('http://127.0.0.1:7860/health', timeout=2)"

CMD ["/app/start.sh"]
