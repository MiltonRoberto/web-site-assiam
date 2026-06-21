"""
Pipeline de ingestão: carrega documentos da pasta docs/, divide em chunks,
gera embeddings locais via FastEmbed (onnxruntime, sem API key) e persiste no ChromaDB.
"""
import os
from langchain_community.document_loaders import PyMuPDFLoader, TextLoader
from langchain_community.embeddings import FastEmbedEmbeddings
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma

from .config import settings


def _carregar_documentos(docs_path: str) -> list:
    docs = []
    for nome in os.listdir(docs_path):
        caminho = os.path.join(docs_path, nome)
        if nome.endswith(".pdf"):
            loader = PyMuPDFLoader(caminho)
        elif nome.endswith(".txt"):
            loader = TextLoader(caminho, encoding="utf-8")
        else:
            continue
        docs.extend(loader.load())
    return docs


def ingerir(docs_path: str | None = None, chroma_path: str | None = None) -> int:
    docs_path  = docs_path  or settings.docs_path
    chroma_path = chroma_path or settings.chroma_path

    documentos = _carregar_documentos(docs_path)
    if not documentos:
        return 0

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=512,
        chunk_overlap=50,
        separators=["\n\n", "\n", ".", " "],
    )
    chunks = splitter.split_documents(documentos)

    embeddings = FastEmbedEmbeddings(model_name=settings.embedding_model)

    Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=chroma_path,
    )
    return len(chunks)
