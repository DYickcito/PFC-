"""
Punto de entrada principal de la API FastAPI.
Configura CORS, el lifespan (startup/shutdown) y monta todos los routers.
"""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.qdrant_setup import ensure_collection, qdrant_client
from app.services.rag_service import init_rag_settings
from app.routers import ingest, chat

# Configuración de logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Eventos de inicio y cierre de la aplicación.
    Startup: verificar/crear la colección en Qdrant.
    """
    logger.info("🚀 Iniciando Módulo RAG Institucional...")

    # Crear directorio de uploads si no existe
    os.makedirs(settings.upload_dir, exist_ok=True)

    # Inicializar modelo de embeddings Gemini en LlamaIndex
    init_rag_settings()

    # Verificar / crear colección Qdrant (3072 dims)
    ensure_collection(qdrant_client)

    logger.info("✅ Aplicación lista para recibir solicitudes.")
    yield
    logger.info("🛑 Cerrando aplicación...")


# ─────────────────────────────────────────────
# Inicialización de FastAPI
# ─────────────────────────────────────────────
app = FastAPI(
    title="Módulo RAG Institucional",
    description=(
        "API para el sistema RAG de la IA Institucional. "
        "Permite ingestar documentos y realizar consultas con LLMs de Groq "
        "usando recuperación semántica sobre Qdrant."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",       # Swagger UI
    redoc_url="/redoc",     # ReDoc
)

# ─────────────────────────────────────────────
# CORS - Permite peticiones desde el frontend React
# ─────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# Routers
# ─────────────────────────────────────────────
app.include_router(ingest.router)
app.include_router(chat.router)


# ─────────────────────────────────────────────
# Health Check
# ─────────────────────────────────────────────
@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "service": "RAG Institucional Backend"}
