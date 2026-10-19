FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/* && useradd -m mapper
WORKDIR /app
COPY analyzer.py server.py ./
RUN mkdir /data && chown mapper:mapper /data
USER mapper
ENV LM_BIND=0.0.0.0 LM_PORT=8787 LM_DB=/data/mapper.sqlite3
EXPOSE 8787
VOLUME ["/data"]
CMD ["python", "server.py"]
