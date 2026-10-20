"""
Router de consultas RAG (Chat).

Endpoints:
  POST /api/v1/chat/query
    - Recibe un prompt y el nombre del modelo LLM a usar
    - Ejecuta la pipeline RAG: recuperación en Qdrant, enrutamiento por
      puntaje de similitud y generación con Groq
    - Guarda la consulta en la tabla `consulta` de Supabase (historial)
    - Retorna la respuesta, las fuentes citadas y si se usó contexto oficial

  GET /api/v1/chat/models
    - Retorna los modelos LLM disponibles para selección en el frontend

  GET /api/v1/chat/history
    - Retorna las últimas consultas del usuario autenticado (las fijadas primero)

  PATCH /api/v1/chat/history/{consulta_id}
    - Fija o desfija una consulta del historial

  POST /api/v1/chat/history/delete
    - Borra consultas del historial: las elegidas o todas las no fijadas
"""
import logging
import time
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.security import get_current_user
from app.db.supabase_client import get_supabase_client
from app.services.rag_service import (
    ALLOWED_MODELS,
    DEFAULT_MODEL,
    LLM_MODELS,
    query_rag,
)

logger = logging.getLogger(__name__)

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
        default=DEFAULT_MODEL,
        description=f"Modelo LLM a usar. Opciones: {', '.join(LLM_MODELS)}",
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
    uso_contexto: bool = Field(
        description="True si la respuesta se basó en documentos oficiales; "
                    "False si ningún fragmento superó el umbral de similitud.",
    )
    max_score: float | None = Field(description="Puntaje del fragmento más parecido.")
    umbral: float = Field(description="Umbral de similitud configurado.")
    tiempo_ms: int = Field(description="Tiempo total de la consulta en milisegundos.")


class HistoryPin(BaseModel):
    fijada: bool


class HistoryDelete(BaseModel):
    ids: list[UUID] = Field(default_factory=list, max_length=100,
                            description="Consultas a borrar.")
    todas: bool = Field(default=False,
                        description="Borrar todo el historial del usuario en vez de las elegidas.")
    incluir_fijadas: bool = Field(default=False,
                                  description="Con todas=True, borrar también las fijadas.")


# ─────────────────────────────────────────────
# Historial
# ─────────────────────────────────────────────
def _save_consulta(user_id: str, prompt: str, result: dict) -> None:
    """
    Registra la consulta en la tabla `consulta` de Supabase.
    Se ejecuta en segundo plano: si falla (por ejemplo, si la tabla aún no
    se creó), solo se registra en el log y la respuesta al usuario no se ve
    afectada. El script de creación está en Backend/sql/consulta.sql.
    """
    try:
        get_supabase_client().table("consulta").insert({
            "id_usuario": user_id,
            "pregunta": prompt,
            "respuesta": result["response"],
            "modelo": result["model_used"],
            "uso_contexto": result["uso_contexto"],
            "score_max": result["max_score"],
            "fragmentos": len(result["sources"]),
            "tiempo_ms": result["tiempo_ms"],
        }).execute()
    except Exception as e:
        logger.warning(f"⚠️ No se pudo guardar la consulta en el historial: {e}")


# ─────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────
@router.get("/models")
async def get_available_models(current_user: dict = Depends(get_current_user)):
    """
    Retorna la lista de modelos LLM disponibles para selección en el frontend.
    """
    return {
        "default": DEFAULT_MODEL,
        "models": [{"id": mid, "label": info["label"]} for mid, info in LLM_MODELS.items()],
    }


@router.post("/query", response_model=ChatResponse)
async def chat_query(
    request: ChatRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """
    Procesa una consulta RAG institucional.

    - **prompt**: Pregunta del usuario.
    - **model_name**: Modelo Groq a usar para generar la respuesta.
    - **similarity_top_k**: Cuántos fragmentos recuperar de la base de datos vectorial.

    Requiere token JWT válido en el header `Authorization: Bearer <token>`.
    """
    if request.model_name not in ALLOWED_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Modelo '{request.model_name}' no válido. "
                   f"Opciones: {sorted(ALLOWED_MODELS)}",
        )

    start = time.perf_counter()
    try:
        result = await query_rag(
            prompt=request.prompt,
            model_name=request.model_name,
            similarity_top_k=request.similarity_top_k,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("Error en consulta RAG")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al procesar la consulta RAG: {str(e)}",
        )
    result["tiempo_ms"] = int((time.perf_counter() - start) * 1000)

    background_tasks.add_task(_save_consulta, current_user["user_id"], request.prompt, result)
    return result


@router.get("/history")
async def get_history(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Retorna las últimas consultas del usuario autenticado, de la más reciente a la más antigua."""
    try:
        result = (
            get_supabase_client()
            .table("consulta")
            .select("id, pregunta, respuesta, modelo, uso_contexto, score_max, fragmentos, tiempo_ms, fecha, fijada")
            .eq("id_usuario", current_user["user_id"])
            .order("fijada", desc=True)
            .order("fecha", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"No se pudo leer el historial: {str(e)}",
        )
    return {"consultas": result.data or []}


@router.patch("/history/{consulta_id}")
async def pin_history_item(
    consulta_id: UUID,
    body: HistoryPin,
    current_user: dict = Depends(get_current_user),
):
    """Fija o desfija una consulta. Solo afecta consultas del propio usuario."""
    try:
        result = (
            get_supabase_client()
            .table("consulta")
            .update({"fijada": body.fijada})
            .eq("id", str(consulta_id))
            .eq("id_usuario", current_user["user_id"])
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"No se pudo actualizar la consulta: {str(e)}",
        )
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consulta no encontrada.")
    return {"id": str(consulta_id), "fijada": body.fijada}


@router.post("/history/delete")
async def delete_history(
    body: HistoryDelete,
    current_user: dict = Depends(get_current_user),
):
    """
    Borra consultas del historial del usuario autenticado.
    Con `ids` borra esas consultas (fijadas o no). Con `todas` borra el
    historial completo; las fijadas se conservan salvo `incluir_fijadas`.
    """
    if not body.todas and not body.ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Indica las consultas a borrar o usa todas=true.",
        )
    try:
        query = (
            get_supabase_client()
            .table("consulta")
            .delete()
            .eq("id_usuario", current_user["user_id"])
        )
        if body.todas:
            if not body.incluir_fijadas:
                query = query.eq("fijada", False)
        else:
            query = query.in_("id", [str(i) for i in body.ids])
        result = query.execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"No se pudo borrar el historial: {str(e)}",
        )
    return {"borradas": len(result.data or [])}
