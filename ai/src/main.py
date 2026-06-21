from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .ingestao import ingerir
from .agente import perguntar

app = FastAPI(title="AASIAM AI Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class PerguntaRequest(BaseModel):
    pergunta: str


class PerguntaResponse(BaseModel):
    resposta: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/ingestao")
def rota_ingestao():
    """Reprocessa todos os documentos da pasta docs/ e atualiza o ChromaDB."""
    try:
        total = ingerir()
        return {"chunks_indexados": total}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/perguntar", response_model=PerguntaResponse)
def rota_perguntar(body: PerguntaRequest):
    """Recebe uma pergunta e retorna a resposta baseada nos documentos indexados."""
    try:
        resposta = perguntar(body.pergunta)
        return PerguntaResponse(resposta=resposta)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
