FROM node:20.19.0-bookworm-slim AS client-build

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html metadata.json tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

RUN pip install --no-cache-dir uv==0.7.9

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY app ./app
COPY --from=client-build /build/dist/client ./dist/client

EXPOSE 10000

CMD ["sh", "-c", "exec uvicorn app.main:app --no-proxy-headers --host 0.0.0.0 --port \"${PORT:-10000}\""]
