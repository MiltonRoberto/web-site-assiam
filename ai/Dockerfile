FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY docs/ ./docs/

# Pre-download embedding model into the image layer (without network at runtime)
RUN python -c "from fastembed import TextEmbedding; list(TextEmbedding(model_name='BAAI/bge-small-en-v1.5').embed(['warmup']))"

# Build ChromaDB from docs/ — Groq key not used during ingestion
ENV GROQ_API_KEY=build_placeholder
RUN python -c "from src.ingestao import ingerir; n = ingerir(); print(f'Indexados: {n} chunks')"

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
