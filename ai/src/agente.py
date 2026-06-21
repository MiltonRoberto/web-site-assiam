"""
Agente RAG: busca contexto no ChromaDB via embeddings locais FastEmbed
e responde usando o LLM da Groq com base nos documentos indexados.
"""
from langchain_groq import ChatGroq
from langchain_community.embeddings import FastEmbedEmbeddings
from langchain_chroma import Chroma
from langchain.prompts import ChatPromptTemplate
from langchain.schema.runnable import RunnablePassthrough
from langchain.schema.output_parser import StrOutputParser

from .config import settings

SYSTEM_PROMPT = """Você é o assistente virtual da AASIAM (Associação Atlética de Sistemas da AMF), chamada de Alcateia.
Responda perguntas sobre os produtos da loja e sobre a atlética com base EXCLUSIVAMENTE no contexto fornecido abaixo.

Regras:
- Interprete termos informais e abreviações: "caneca" = caneca com tirante, "moletom" = moletom verde ou off-white, "mochila" = mochila com listras ou com estampa, "kit" ou "combo" = pacotes com desconto.
- Se o usuário perguntar sobre um produto pelo nome informal, identifique qual produto corresponde e responda com preço e informações.
- Se a informação não estiver no contexto, diga: "Não tenho essa informação no momento."
- Seja direto, simpático e use linguagem informal.
- Não invente preços, tamanhos ou informações que não estejam no contexto.
- Ao listar produtos, use formato de lista com nome e preço.

Contexto:
{context}
"""

_chain = None


def _get_chain():
    global _chain
    if _chain is not None:
        return _chain

    embeddings = FastEmbedEmbeddings(model_name=settings.embedding_model)

    vectorstore = Chroma(
        persist_directory=settings.chroma_path,
        embedding_function=embeddings,
    )
    retriever = vectorstore.as_retriever(
        search_type="mmr",
        search_kwargs={"k": 5, "fetch_k": 20, "lambda_mult": 0.5},
    )

    llm = ChatGroq(
        model=settings.groq_model,
        temperature=0,
        api_key=settings.groq_api_key,
    )

    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        ("human", "{question}"),
    ])

    def formatar_docs(docs):
        return "\n\n".join(d.page_content for d in docs)

    _chain = (
        {"context": retriever | formatar_docs, "question": RunnablePassthrough()}
        | prompt
        | llm
        | StrOutputParser()
    )
    return _chain


def perguntar(pergunta: str) -> str:
    return _get_chain().invoke(pergunta)
