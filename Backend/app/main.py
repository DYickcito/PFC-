"""
Punto de entrada principal de la API FastAPI.
Configura CORS, el lifespan (startup/shutdown) y monta todos los routers.
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.qdrant_setup import ensure_collection, qdrant_client
from app.core import security
from app.services.rag_service import _load_index_from_qdrant, catalogo_documentos, init_rag_settings
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

    # Precargar lo que si no tendría que esperar la primera consulta:
    # catálogo de documentos, índice de Qdrant y llaves para validar tokens
    await asyncio.to_thread(_precalentar)

    logger.info("✅ Aplicación lista para recibir solicitudes.")
    yield
    logger.info("🛑 Cerrando aplicación...")


def _precalentar() -> None:
    try:
        catalogo_documentos()
        _load_index_from_qdrant()
        security._llaves_publicas()
        logger.info("🔥 Catálogo, índice y llaves del token precargados.")
    except Exception as e:
        logger.warning(f"⚠️ No se pudo precargar todo (se cargará en la primera consulta): {e}")


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
