FROM python:3.12-alpine
# docker + compose: logs and the update; git + su-exec: the update runs git as the owner of the project folder
RUN apk add --no-cache docker-cli docker-cli-compose git su-exec
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY control.py .
CMD ["python", "control.py"]
