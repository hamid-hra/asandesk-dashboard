FROM python:3.12-alpine
# docker + compose: logs and the update; git + su-exec: the update runs git as the owner of the project folder.
# buildx: without it compose uses the classic builder, which rejects `RUN --mount=type=cache` in the other Dockerfiles.
RUN apk add --no-cache docker-cli docker-cli-compose docker-cli-buildx git su-exec
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY control.py .
CMD ["python", "control.py"]
