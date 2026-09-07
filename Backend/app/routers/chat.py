"""
Router de consultas RAG (Chat).

Endpoints:
  POST /api/v1/chat/query
    - Recibe un prompt y el nombre del modelo LLM a usar
    - Ejecuta la pipeline RAG: Recuperación de vectores en Qdrant + Generación con Groq
    - Retorna la respuesta y las fuentes citadas

  GET /api/v1/chat/models
    - Retorna los modelos LLM disponibles para selección en el frontend
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import get_current_user
from app.services.rag_service import query_rag, ALLOWED_MODELS

router = APIRouter(prefix="/api/v1/chat", tags=["Chat RAG"])


# ─────────────────────────────────────────────
# Schemas de Request / Response
# ─────────────────────────────────────────────
class ChatRequest(BaseModel):
    prompt: str = Field(
        ...,
        min_length=3,
        max_length=2000,
        description="Pregunta o consulta del usuario.",
    )
    model_name: str = Field(
        default="qwen/qwen3-27b",
        description="Modelo LLM a usar. Opciones: qwen/qwen3-27b, openai/gpt-oss-20b",
    )
    similarity_top_k: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Número de fragmentos relevantes a recuperar de Qdrant.",
    )


class SourceNode(BaseModel):
    document_id: str
    nombre_documento: str
    score: float | None
    texto_fragmento: str


class ChatResponse(BaseModel):
    response: str
    sources: list[SourceNode]
    model_used: str


# ─────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────
@router.get("/models")
async def get_available_models(current_user: dict = Depends(get_current_user)):
    """
    Retorna la lista de modelos LLM disponibles para selección en el frontend.
    """
    return {
        "models": [
            {"id": "qwen/qwen3-27b", "label": "Qwen 3.6 27B (Groq)"},
            {"id": "openai/gpt-oss-20b", "label": "GPT-OSS 20B (Groq)"},
        ]
    }


@router.post("/query", response_model=ChatResponse)
async def chat_query(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Procesa una consulta RAG institucional.

    - **prompt**: Pregunta del usuario.
    - **model_name**: Modelo Groq a usar para generar la respuesta.
    - **similarity_top_k**: Cuántos fragmentos recuperar de la base de datos vectorial.

    Requiere token JWT válido en el header `Authorization: Bearer <token>`.
    """
    # Validar que el modelo solicitado sea permitido
    if request.model_name not in ALLOWED_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Modelo '{request.model_name}' no válido. "
                   f"Opciones: {sorted(ALLOWED_MODELS)}",
        )

    try:
        result = await query_rag(
            prompt=request.prompt,
            model_name=request.model_name,
            similarity_top_k=request.similarity_top_k,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al procesar la consulta RAG: {str(e)}",
        )

    return result
