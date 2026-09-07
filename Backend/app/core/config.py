"""
Configuración centralizada de la aplicación.
Carga todas las variables de entorno desde el archivo .env.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # --- Supabase ---
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_jwt_secret: str

    # --- Qdrant ---
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str = ""
    qdrant_collection_name: str = "documentos_institucionales"

    # --- Gemini Embeddings ---
    gemini_api_key: str
    # Dimensión de vectores del modelo gemini-embedding-2
    embedding_dim: int = 3072
    # IDs de modelo disponibles en Groq
    available_llm_models: List[str] = ["qwen/qwen3-27b", "openai/gpt-oss-20b"]

    # --- Groq LLM ---
    groq_api_key: str

    # --- App ---
    app_env: str = "development"
    allowed_origins: str = "http://localhost:5173"
    upload_dir: str = "uploads"

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]


# Instancia singleton accesible desde cualquier módulo
settings = Settings()
