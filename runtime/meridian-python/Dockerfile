FROM python:3.12.11-slim-bookworm@sha256:c00fc7b44d844b6da22861ec24af43968a5200eac4ec607b4725d585165d6b49
ARG SOURCE_REVISION
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/juntai/meridian-runtime
COPY requirements.txt profile.json inventory.py verify.py ./
RUN python -m pip install --no-cache-dir --only-binary=:all: --require-hashes --report installation-report.json -r requirements.txt \
    && python -m pip check \
    && python inventory.py "${SOURCE_REVISION}" \
    && python verify.py --embedded \
    && groupadd --gid 65532 juntai \
    && useradd --uid 65532 --gid 65532 --no-create-home --shell /usr/sbin/nologin juntai \
    && chmod -R a-w /opt/juntai/meridian-runtime
LABEL org.opencontainers.image.title="Juntai platform Meridian Python runtime" \
      org.opencontainers.image.version="1.1.0" \
      org.opencontainers.image.source="https://github.com/zephytiju/JuntaiPlatformFoundationsIaC" \
      org.opencontainers.image.revision="${SOURCE_REVISION}"
USER 65532:65532
CMD ["python", "/opt/juntai/meridian-runtime/verify.py", "--embedded"]
