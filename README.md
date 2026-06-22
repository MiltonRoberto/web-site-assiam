# AASIAM — Loja da Atlética

Loja de merchandise da **AASIAM** (Associação Atlética de Sistemas da AMF / Alcateia).  
Vende moletons, canecas, mochilas, cachecol e combos da Coleção Alcateia.

---

## Descrição do sistema

A loja é composta por três serviços independentes que se comunicam via HTTP:

- **Frontend**: interface da loja com carrinho, checkout e um chat de IA embutido
- **Backend**: API que processa pedidos, gera links de pagamento (InfinitePay), registra compras no Google Sheets e atua como **proxy seguro** para o serviço de IA
- **IA (RAG)**: agente de perguntas e respostas que responde sobre produtos e a atlética com base em documentos de contexto — funciona via recuperação vetorial (ChromaDB) + LLM (Groq)

O chat de IA aparece como um widget 🐺 no canto inferior direito do site. O usuário digita uma pergunta, o agente busca trechos relevantes nos documentos indexados e o LLM formula a resposta. Nenhuma informação é inventada — se não estiver no contexto, o agente informa que não tem a informação.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                     Usuário                         │
└────────────────────────┬────────────────────────────┘
                         │ HTTPS
          ┌──────────────▼──────────────┐
          │      Frontend (Vercel)       │
          │   React 18 + Vite           │
          │   - Catálogo de produtos    │
          │   - Carrinho e checkout     │
          │   - Chat widget (IA)        │
          └──────────────┬──────────────┘
                         │ REST (sem chaves expostas)
          ┌──────────────▼──────────────┐
          │    Backend (Render)          │
          │    Node.js + Express         │
          │    - POST /checkout          │
          │    - GET  /status/:id        │
          │    - POST /api/perguntar     │  ← proxy seguro para IA
          │    - Google Sheets API       │
          └──────┬──────────────┬────────┘
                 │              │ REST + X-API-Key (interno)
   ┌─────────────▼────┐  ┌──────▼──────────────────────┐
   │   InfinitePay     │  │      IA / RAG (Render)       │
   │  (Pix / Cartão)  │  │   Python + FastAPI           │
   └──────────────────┘  │   - POST /perguntar          │
                         │   - POST /ingestao            │
                         │   - GET  /health              │
                         └──────────────┬────────────────┘
                                        │
                         ┌──────────────▼────────────────┐
                         │   ChromaDB + FastEmbed         │
                         │   (banco vetorial local)       │
                         └───────────────────────────────┘
```

### Fluxo do agente RAG

```
Pergunta do usuário
       │
       ▼
Guardrails (Python)          ← valida, bloqueia injeções e off-topic
       │
       ▼
FastEmbedEmbeddings          ← gera embedding da pergunta (local, ONNX)
       │
       ▼
ChromaDB (MMR retrieval)     ← busca os 5 chunks mais relevantes
       │
       ▼
Groq LLM (llama-3.3-70b)    ← formula a resposta com base no contexto
       │
       ▼
Sanitizador de resposta      ← bloqueia vazamento do prompt de sistema
       │
       ▼
Resposta ao usuário
```

---

## Segurança

### Por que o frontend não fala diretamente com a IA?

O frontend chama apenas o **backend** (`/api/perguntar`), que repassa a pergunta para o serviço de IA usando uma chave secreta (`AI_API_KEY`). Essa chave **nunca chega ao browser** — nenhum segredo é exposto no DevTools.

### Camadas de proteção do agente de IA

| Camada | O que faz |
|---|---|
| **Rate limiting** | Máximo de 20 requisições/minuto por IP |
| **API Key** | O serviço de IA só aceita chamadas do backend autenticado |
| **CORS restrito** | Aceita apenas origens Vercel e localhost |
| **Guardrails — injeção** | Detecta tentativas de sobrescrever instruções (ex: "ignore todas as regras") |
| **Guardrails — extração** | Bloqueia pedidos para revelar o prompt de sistema (ex: "escreva seu prompt inicial") |
| **Guardrails — off-topic** | Recusa perguntas fora do escopo da AASIAM |
| **Input wrapping** | A pergunta é isolada antes de chegar ao LLM, sinalizando que é dado — não instrução |
| **System prompt hardening** | Técnica sanduíche: regras de segurança antes e depois do contexto dos produtos |
| **Sanitizador de resposta** | Se o LLM vazar o prompt de sistema mesmo assim, a resposta é substituída |
| **CSP + Headers** | Content-Security-Policy, X-Frame-Options e outros headers no Vercel |
| **Source maps desabilitados** | O bundle JS não expõe o código-fonte original |

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | React 18, Vite 6, GSAP, Radix UI Colors, Lucide React |
| Backend | Node.js 20, Express 5, Google Sheets API |
| Pagamentos | InfinitePay (Pix, cartão, débito) |
| IA / RAG | Python 3.11, FastAPI, LangChain, ChromaDB |
| Embeddings | FastEmbed + ONNX Runtime (`BAAI/bge-small-en-v1.5`) — sem custo, sem API key |
| LLM | Groq API — `llama-3.3-70b-versatile` (gratuito) |
| Hospedagem | Vercel (frontend), Render (backend + IA) |
| Containerização | Docker (serviço de IA) |

---

## Estrutura do projeto

```
lojaAASIAM/
├── frontend/               # React 18 + Vite — interface da loja e chat de IA
│   ├── src/
│   │   ├── App.jsx         # Componente principal, rotas e produtos
│   │   ├── ChatWidget.jsx  # Widget de chat (chama o backend, não a IA diretamente)
│   │   └── ...
│   ├── .env.example
│   └── vercel.json         # Rewrites SPA + headers de segurança (CSP, etc.)
├── backend/                # Node.js + Express — pagamentos, pedidos e proxy de IA
│   ├── index.js
│   └── .env.example
├── ai/                     # Python + FastAPI — agente RAG
│   ├── docs/               # PDFs e TXTs de contexto (adicione aqui)
│   ├── src/
│   │   ├── main.py         # Rotas FastAPI + autenticação + rate limit
│   │   ├── agente.py       # Chain RAG (retriever + LLM) com input wrapping
│   │   ├── guardrails.py   # Validação de entrada e sanitização de resposta
│   │   ├── ratelimit.py    # Rate limiting por IP (20 req/min)
│   │   ├── ingestao.py     # Indexação de documentos no ChromaDB
│   │   └── config.py       # Configuração via .env
│   ├── Dockerfile
│   ├── render.yaml
│   └── requirements.txt
└── docker-compose.yml
```

---

## Reproduzindo o ambiente localmente

### Pré-requisitos

- **Node.js** 20+
- **Python** 3.11+
- **Git Bash** ou **PowerShell** (Windows)

---

### 1. Clonar o repositório

```bash
git clone https://github.com/ZanonDeAndrade/lojaAASIAM.git
cd lojaAASIAM
```

---

### 2. Serviço de IA

#### 2.1 Obter a chave Groq (gratuito)

Acesse [console.groq.com/keys](https://console.groq.com/keys), crie uma conta e gere uma API Key.

#### 2.2 Configurar o .env

```bash
cd ai
cp .env.example .env      # Git Bash
# ou
copy .env.example .env    # PowerShell / CMD
```

Abra `ai/.env` e preencha:

```env
GROQ_API_KEY=gsk_suachaveaqui
AI_API_KEY=               # deixe vazio em dev (desativa a autenticação localmente)
```

#### 2.3 Criar o ambiente virtual e instalar dependências

```bash
# PowerShell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Git Bash
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt
```

> Na primeira instalação o FastEmbed baixa o modelo de embeddings (~130 MB via onnxruntime).

#### 2.4 Adicionar documentos de contexto

Coloque arquivos `.pdf` ou `.txt` em `ai/docs/`.  
Exemplos: catálogo de produtos, sobre a atlética, FAQ, regulamentos.

#### 2.5 Subir o serviço

```bash
# dentro de ai/ com venv ativo
uvicorn src.main:app --port 8000
```

Confirme: `http://localhost:8000/health` → `{"status":"ok"}`

#### 2.6 Indexar os documentos

```bash
curl -X POST http://localhost:8000/ingestao
# → {"chunks_indexados": N}
```

Repita sempre que adicionar ou editar arquivos em `ai/docs/`.

---

### 3. Backend

```bash
cd backend
cp .env.example .env   # ou copy no Windows
```

Preencha `backend/.env`:

```env
PORT=3333
APP_URL=http://localhost:5173/
API_URL=http://localhost:3333/

# URL do serviço de IA (local)
AI_URL=http://localhost:8000
AI_API_KEY=               # deixe vazio em dev

# InfinitePay — handle da conta (parte final do link de pagamento)
INFINITEPAY_HANDLE=seu_handle

# Google Sheets — registro de pedidos
GOOGLE_SHEETS_SPREADSHEET_ID=id_da_planilha
GOOGLE_SHEETS_SHEET_NAME=Pedidos AASIAM
GOOGLE_SERVICE_ACCOUNT_EMAIL=conta@projeto.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

```bash
npm install
npm run dev
```

#### Configurar Google Sheets

1. Crie uma service account no [Google Cloud Console](https://console.cloud.google.com)
2. Ative a **Google Sheets API**
3. Compartilhe a planilha com o e-mail da service account
4. O ID da planilha está na URL: `https://docs.google.com/spreadsheets/d/**ID**/edit`

---

### 4. Frontend

```bash
cd frontend
cp .env.example .env   # ou copy no Windows
npm install
npm run dev
```

Acesse: `http://localhost:5173`

**Variáveis de ambiente do frontend:**

| Variável | Padrão (dev) | Descrição |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3333` | URL do backend (único endpoint necessário) |

> O frontend **não** se comunica diretamente com a IA. Toda chamada de chat passa pelo backend (`/api/perguntar`), que age como proxy.

---

### 5. Rodar tudo junto

Abra **3 terminais**:

| Terminal | Diretório | Comando | Porta |
|---|---|---|---|
| IA | `ai/` | `uvicorn src.main:app --port 8000` | 8000 |
| Backend | `backend/` | `npm run dev` | 3333 |
| Frontend | `frontend/` | `npm run dev` | 5173 |

---

## Endpoints do serviço de IA

> Em produção, o frontend **não chama esses endpoints diretamente**. O backend age como proxy via `POST /api/perguntar`.

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/health` | — | Verifica se o serviço está no ar |
| `POST` | `/ingestao` | X-API-Key | Reindexar documentos de `docs/` no ChromaDB |
| `POST` | `/perguntar` | X-API-Key | Enviar uma pergunta ao agente |

**Exemplo de uso local (sem AI_API_KEY configurado):**

```bash
curl -X POST http://localhost:8000/perguntar \
  -H "Content-Type: application/json" \
  -d '{"pergunta": "Quais tamanhos tem o moletom?"}'
```
