"""
Configuración y setup de la colección en Qdrant.
Garantiza que la colección exista con exactamente 3072 dimensiones (gemini-embedding-2).
"""
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

# Dimensión exacta requerida por models/gemini-embedding-2
VECTOR_SIZE = 3072
DISTANCE_METRIC = Distance.COSINE


def get_qdrant_client() -> QdrantClient:
    """Retorna el cliente Qdrant configurado."""
    kwargs = {"url": settings.qdrant_url}
    if settings.qdrant_api_key:
        kwargs["api_key"] = settings.qdrant_api_key
    return QdrantClient(**kwargs)


def ensure_collection(client: QdrantClient) -> None:
    """
    Verifica que la colección exista en Qdrant.
    Si no existe, la crea con vectores de 3072 dimensiones y distancia coseno.
    """
    collection_name = settings.qdrant_collection_name
    existing = [c.name for c in client.get_collections().collections]

    if collection_name not in existing:
        logger.info(
            f"Colección '{collection_name}' no encontrada. Creando con "
            f"{VECTOR_SIZE} dimensiones y métrica {DISTANCE_METRIC}..."
        )
        client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(
                size=VECTOR_SIZE,
                distance=DISTANCE_METRIC,
            ),
        )
        logger.info(f"✅ Colección '{collection_name}' creada exitosamente.")
    else:
        logger.info(f"✅ Colección '{collection_name}' ya existe en Qdrant.")


# Instancias singleton
qdrant_client: QdrantClient = get_qdrant_client()
