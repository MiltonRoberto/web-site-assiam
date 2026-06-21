from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    groq_api_key: str
    groq_model: str = "llama-3.3-70b-versatile"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    chroma_path: str = "./chroma_db"
    docs_path: str = "./docs"

    class Config:
        env_file = ".env"


settings = Settings()
