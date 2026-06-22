from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .ingestao import ingerir
from .agente import perguntar
from .guardrails import validate_input, is_on_topic, OFF_TOPIC_REPLY, sanitize_response
from .ratelimit import is_allowed
from .config import settings

app = FastAPI(
    title="AASIAM AI Agent",
    version="1.0.0",
    docs_url=None,      # desabilita /docs em produção
    redoc_url=None,     # desabilita /redoc em produção
    openapi_url=None,   # desabilita /openapi.json
)

# ── CORS — só aceita o domínio da Vercel e localhost ─────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://([\w-]+\.)?vercel\.app|http://localhost:\d+",
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "X-API-Key"],
)


# ── Dependências de segurança ─────────────────────────────────────────────────

def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def require_api_key(request: Request):
    """Valida X-API-Key se AI_API_KEY estiver configurado."""
    if not settings.ai_api_key:
        return  # dev local: sem chave configurada, passa livre
    key = request.headers.get("X-API-Key", "")
    if key != settings.ai_api_key:
        raise HTTPException(status_code=401, detail="Não autorizado.")


def require_rate_limit(request: Request):
    """Bloqueia IPs que ultrapassem 20 req/min."""
    ip = _get_client_ip(request)
    if not is_allowed(ip):
        raise HTTPException(
            status_code=429,
            detail="Muitas requisições. Tente novamente em alguns segundos.",
        )


# ── Modelos ───────────────────────────────────────────────────────────────────

class PerguntaRequest(BaseModel):
    pergunta: str


class PerguntaResponse(BaseModel):
    resposta: str


# ── Rotas ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post(
    "/ingestao",
    dependencies=[Depends(require_api_key)],
)
def rota_ingestao():
    """Reprocessa documentos de docs/ e atualiza o ChromaDB. Requer API key."""
    try:
        total = ingerir()
        return {"chunks_indexados": total}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Erro interno.")


@app.post(
    "/perguntar",
    response_model=PerguntaResponse,
    dependencies=[Depends(require_api_key), Depends(require_rate_limit)],
)
def rota_perguntar(body: PerguntaRequest):
    """Recebe pergunta e retorna resposta RAG. Requer API key + respeita rate limit."""
    valid, err = validate_input(body.pergunta)
    if not valid:
        return PerguntaResponse(resposta=err)

    if not is_on_topic(body.pergunta):
        return PerguntaResponse(resposta=OFF_TOPIC_REPLY)

    try:
        resposta = perguntar(body.pergunta)
        resposta = sanitize_response(resposta)
        return PerguntaResponse(resposta=resposta)
    except Exception:
        raise HTTPException(status_code=500, detail="Erro interno.")
