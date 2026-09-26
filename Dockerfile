FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.13-slim
WORKDIR /app
COPY pyproject.toml ./
COPY src/ src/
RUN pip install --no-cache-dir -e .
COPY eval/ eval/
COPY --from=web /web/dist web/dist
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["sh", "-c", "if [ ! -f data/index/manifest.json ]; then rulekeeper ingest; fi; exec rulekeeper serve --host 0.0.0.0"]
