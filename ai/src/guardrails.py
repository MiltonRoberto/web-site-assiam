import re

MAX_INPUT_LENGTH = 500

OFF_TOPIC_REPLY = (
    "Só consigo responder sobre a AASIAM, seus produtos e a atlética. "
    "Tem alguma dúvida sobre isso? 🐺"
)

INJECTION_REPLY = (
    "Não consigo seguir esse tipo de instrução. "
    "Estou aqui para responder sobre a AASIAM e seus produtos! 🐺"
)

# ── Detecção por combinação de conceitos ─────────────────────────────────────
# Mais robusto que regex exatos: qualquer bypass verb + qualquer target noun = injeção

_BYPASS_VERBS = re.compile(
    r"\b(ignor[ae]|esque[cç]a?|desconsider[ae]|abandone?|desative?|remova?|"
    r"override|bypass|disable|remove|forget|neglect|disregard|drop)\b",
    re.IGNORECASE,
)

_BYPASS_NOUNS = re.compile(
    r"\b(instru[cç][oõ]es?|regras?|anteriore?s?|pr[eé]vias?|previous|"
    r"prompt|sistema|system|guidelines?|constraints?|filtros?|contexto|context|"
    r"limita[cç][oõ]es?|restri[cç][oõ]es?)\b",
    re.IGNORECASE,
)

# Verbos que pedem para revelar o conteúdo do prompt
_EXTRACT_VERBS = re.compile(
    r"\b(escreva?|revele?|mostre?|repita|diga|fale|conte?|liste?|cite|copie?|"
    r"imprima?|exiba?|retorne?|write|reveal|show|tell|repeat|print|output|display)\b",
    re.IGNORECASE,
)

# Alvos de extração do prompt de sistema
_EXTRACT_TARGETS = re.compile(
    r"\b(prompt|instru[cç][oõ]es?|regras?|sistema|system|inicial|original|"
    r"secret|segredo|confidencial|dito\s+a\s+voc[eê]|foi\s+dito|acima|acima\s+disso)\b",
    re.IGNORECASE,
)

# ── Padrões de roleplay / persona / jailbreak (frases inteiras) ──────────────
_PERSONA_PATTERNS = [
    r"(fale|responda|aja|escreva|comporte[\s-]se)\s+como\s+(se\s+(fosse|voc[eê])|o|a|um|uma)\s+\w+",
    r"finja\s+(ser|que\s+(é|voc[eê]\s+[eé]))",
    r"(seja|vire|torne[\s-]se)\s+(o|a|um|uma)\s+\w+",
    r"(act|speak|talk|write|respond)\s+as\s+(if\s+you\s+are|a\s+|the\s+)",
    r"pretend\s+(you\s+are|to\s+be)",
    r"you\s+are\s+now\s+",
    r"a\s+partir\s+de\s+agora\s+(voc[eê]\s+[eé]|seu\s+nome)",
    r"from\s+now\s+on\s+you\s+(are|will)",
    r"\broleplay\b",
    r"\bjailbreak\b",
    r"\bDAN\b",
    r"do\s+anything\s+now",
    r"modo\s+(deus|god|dev|desenvolvedor|irrestrito|livre|sem\s+filtro)",
    r"god\s+mode",
    r"<\s*/?\s*(system|instruction|prompt|assistant|user)\s*>",
    r"\[?\s*(system|assistant|user|inst)\s*\]?\s*:",
    r"(nova?|novo)\s+(persona|papel|identidade|personagem|modo|rol)",
    r"new\s+(persona|role|identity|character|mode)",
]

_ROLEPLAY_NAMES = [
    "goku", "naruto", "batman", "superman", "chatgpt", "openai", "gemini",
    r"claude", r"assistente\s+geral", r"bot\s+geral", r"ia\s+geral",
    "professor", r"m[eé]dico", "advogado", r"psic[oó]logo", "hacker",
]

_ROLEPLAY_TRIGGERS = re.compile(
    r"(fale|aja|seja|responda|escreva|finja|imite)\s+(como|sendo|igual|que)\s+.*(" +
    "|".join(_ROLEPLAY_NAMES) + r")",
    re.IGNORECASE,
)

_COMPILED_PERSONA = [re.compile(p, re.IGNORECASE) for p in _PERSONA_PATTERNS]

# ── Sanitizador de resposta — detecta vazamento do prompt de sistema ──────────
_RESPONSE_LEAK = re.compile(
    r"(instru[cç][oõ]es\s+confidenciais|regras\s+de\s+(conte[uú]do|resposta)|"
    r"você\s+é\s+o\s+assistente\s+virtual\s+da\s+aasiam|"
    r"contexto\s+dos\s+produtos|lembrete\s+(final|de\s+seguran[cç]a)|"
    r"system\s*prompt|prompt\s+de\s+sistema|prompt\s+inicial|"
    r"━━━\s*(segurança|escopo|respostas|contexto))",
    re.IGNORECASE,
)

# ── Palavras-chave de tópico AASIAM ──────────────────────────────────────────
_TOPIC_KEYWORDS = [
    "aasiam", "atlética", "atletica", "alcateia", "lobo", "lobinho",
    "sisinfo", "sistemas", "sistemas de informação", "amf", "faculdade",
    "moletom", "blusa", "casaco", "camiseta", "camisa", "uniforme",
    "caneca", "tirante", "kit", "combo", "pacote",
    "mochila", "bolsa", "cachecol", "lenço",
    "produto", "produtos", "preço", "preco", "valor", "custo",
    "tamanho", "tam", "comprar", "compra", "loja", "pedido",
    "pagamento", "pix", "cartão", "cartao", "débito", "debito", "crédito", "credito",
    "frete", "entrega", "disponível", "disponivel", "esgotado",
    "evento", "esporte", "futebol", "vôlei", "volei", "truco", "campeonato",
    "jogo", "competição", "competicao", "time",
    "diretoria", "instagram", "whatsapp", "contato",
    "coleção", "colecao", "verde", "off-white", "bege",
]

# ── Assuntos explicitamente off-topic ────────────────────────────────────────
_OFF_TOPIC_PATTERNS = [
    r"\b(receita|receitas)\b",
    r"\b(clima|previsão\s+do\s+tempo|temperatura)\b",
    r"\b(política|eleição|presidente|governo)\b",
    r"\b(programação|código|python|javascript|java|html|css)\b",
    r"\b(piada|piadas|humor|engraçado)\b",
    r"\b(tradução|traduza|translate)\b",
    r"\b(resumo|resumir|resume)\b(?!\s+do\s+pedido)",
    r"\b(notícia|notícias|jornal|news)\b",
    r"\b(matemática|calcul[ae]|soma|equação)\b",
]
_COMPILED_OFF_TOPIC = [re.compile(p, re.IGNORECASE) for p in _OFF_TOPIC_PATTERNS]


def _is_injection(text: str) -> bool:
    # 1. Combinação: verbo de bypass + substantivo alvo (ex: "ignore todas as instruções")
    if _BYPASS_VERBS.search(text) and _BYPASS_NOUNS.search(text):
        return True
    # 2. Combinação: verbo de extração + alvo (ex: "escreva seu prompt de sistema inicial")
    if _EXTRACT_VERBS.search(text) and _EXTRACT_TARGETS.search(text):
        return True
    # 3. Padrões de roleplay / persona / jailbreak
    for pattern in _COMPILED_PERSONA:
        if pattern.search(text):
            return True
    # 4. Roleplay com nome de personagem conhecido
    if _ROLEPLAY_TRIGGERS.search(text):
        return True
    return False


def validate_input(pergunta: str) -> tuple[bool, str]:
    """Valida entrada do usuário. Retorna (valido, mensagem_de_erro)."""
    pergunta = pergunta.strip()

    if not pergunta:
        return False, "Por favor, envie uma pergunta."

    if len(pergunta) > MAX_INPUT_LENGTH:
        return False, (
            f"Pergunta muito longa (máximo {MAX_INPUT_LENGTH} caracteres). "
            "Por favor, seja mais breve!"
        )

    if _is_injection(pergunta):
        return False, INJECTION_REPLY

    return True, ""


def is_on_topic(pergunta: str) -> bool:
    """Retorna True se a pergunta é sobre a AASIAM."""
    lower = pergunta.lower().strip()

    # Saudações curtas passam sem necessidade de palavra-chave
    if len(lower) <= 40 and not any(p.search(lower) for p in _COMPILED_OFF_TOPIC):
        return True

    # Assunto explicitamente off-topic → bloqueia
    for pattern in _COMPILED_OFF_TOPIC:
        if pattern.search(lower):
            return False

    # Contém palavra-chave de tópico → libera
    if any(kw in lower for kw in _TOPIC_KEYWORDS):
        return True

    # Pergunta longa sem nenhuma palavra-chave → off-topic
    return False


def sanitize_response(resposta: str) -> str:
    """Última linha de defesa: se o LLM vazar o prompt de sistema, substitui pela resposta segura."""
    if _RESPONSE_LEAK.search(resposta):
        return INJECTION_REPLY
    return resposta
