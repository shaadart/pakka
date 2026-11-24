# syntax=docker/dockerfile:1

# Stage 1: build the virtualenv once.
FROM python:3.12-slim AS deps
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
COPY requirements.txt .
RUN /opt/venv/bin/pip install -r requirements.txt

# Stage 2 (only built by `make test`): the same venv plus pytest, and the tests.
FROM deps AS test
COPY requirements-dev.txt .
RUN /opt/venv/bin/pip install -r requirements-dev.txt
WORKDIR /srv
COPY pytest.ini ./
COPY app ./app
COPY tests ./tests
CMD ["/opt/venv/bin/python", "-m", "pytest", "-q"]

# Stage 3: small runtime image. No pip, no build tools, no tests, non-root user.
FROM python:3.12-slim AS runtime
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 DATABASE_URL=sqlite:////data/app.db
RUN useradd --system --uid 10001 --home-dir /srv app && mkdir /data && chown app /data
COPY --from=deps /opt/venv /opt/venv
WORKDIR /srv
COPY app ./app
USER app
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"
# One worker on purpose: LiteLLM's in-memory cache lives inside the process.
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
