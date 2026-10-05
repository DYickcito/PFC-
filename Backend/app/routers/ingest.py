"""
Router de ingesta de documentos.

Endpoints:
  POST /api/v1/ingest/upload
    - Recibe un archivo (PDF, TXT, DOCX, CSV, XLSX)
    - Guarda el archivo en disco
    - Registra metadatos en la tabla `documento` de Supabase
    - Responde de inmediato (202) y deja la indexación en segundo plano
      (extracción, limpieza, chunking, embeddings Gemini → Qdrant)

  GET /api/v1/ingest/status/{document_id}
    - Estado de la indexación de un documento: procesando / indexado / error

  GET /api/v1/ingest/jobs
    - Estado de las indexaciones desde que se inició el servidor
      (alimenta los contadores "En proceso" y "Con errores" del panel)
"""
import logging
import time
import uuid
from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
import aiofiles

from app.core.config import settings
from app.core.security import require_admin
from app.db.supabase_client import get_supabase_client
from app.services.rag_service import delete_document_vectors, ingest_document

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ingest", tags=["Ingesta"])

# Tipos de archivo permitidos (coinciden con tabla tipo_documento)
ALLOWED_MIME = {
    "application/pdf": "PDF",
    "text/plain": "Txt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
    "text/csv": "CSV",
}

# ─────────────────────────────────────────────
# Registro en memoria del estado de cada indexación.
# Se pierde si el servidor se reinicia; para el prototipo es suficiente.
# ─────────────────────────────────────────────
INGEST_JOBS: dict[str, dict] = {}


async def _run_ingest(file_path: Path, documento_id: str, document_metadata: dict) -> None:
    """
    Tarea en segundo plano: indexa el documento y actualiza su estado.
    Si la indexación falla, se eliminan el registro en Supabase, los vectores
    parciales en Qdrant y el archivo, para que el historial no muestre como
    indexado un documento que no se puede consultar.
    """
    job = INGEST_JOBS[documento_id]
    start = time.perf_counter()
    try:
        nodes_indexed = await ingest_document(
            file_path=str(file_path),
            document_id=documento_id,
            document_metadata=document_metadata,
        )
        job.update(estado="indexado", nodes_indexed=nodes_indexed)
    except Exception as e:
        logger.exception(f"❌ Falló la ingesta de {documento_id}")
        job.update(estado="error", error=str(e))
        try:
            delete_document_vectors(documento_id)
        except Exception:
            logger.warning(f"No se pudieron limpiar los vectores de {documento_id}")
        try:
            get_supabase_client().table("documento").delete().eq("id", documento_id).execute()
        except Exception:
            logger.warning(f"No se pudo eliminar el registro {documento_id} de Supabase")
        file_path.unlink(missing_ok=True)
    finally:
        job["duracion_s"] = round(time.perf_counter() - start, 1)


@router.post("/upload", status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    nombre_documento: str = Form(...),
    descripcion: str = Form(""),
    id_carrera: int = Form(...),
    current_user: dict = Depends(require_admin),
):
    """
    Sube un documento institucional y deja su indexación en segundo plano.

    - **file**: Archivo a cargar (PDF, TXT, DOCX, CSV, XLSX).
    - **nombre_documento**: Nombre descriptivo del documento.
    - **descripcion**: Descripción opcional del contenido.
    - **id_carrera**: ID de la carrera asociada (tabla `carrera`).

    Requiere token JWT válido de un usuario con rol **admin**.
    Alumnos y profesores recibirán HTTP 403.
    El avance se consulta en GET /api/v1/ingest/status/{document_id}.
    """
    # 1. Validar tipo de archivo
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Tipo de archivo no soportado: {file.content_type}. "
                   f"Permitidos: {list(ALLOWED_MIME.values())}",
        )

    # 2. Obtener el tipo_documento_id desde Supabase
    db = get_supabase_client()
    tipo_nombre = ALLOWED_MIME[file.content_type]
    tipo_result = (
        db.table("tipo_documento")
        .select("id")
        .eq("nombre_tipo", tipo_nombre)
        .single()
        .execute()
    )
    if not tipo_result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se encontró el tipo de documento en la base de datos.",
        )
    id_tipo_documento = tipo_result.data["id"]

    # 3. Guardar archivo en disco
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)

    file_extension = Path(file.filename).suffix
    safe_filename = f"{uuid.uuid4()}{file_extension}"
    file_path = upload_dir / safe_filename

    async with aiofiles.open(file_path, "wb") as out_file:
        content = await file.read()
        await out_file.write(content)

    # 4. Registrar metadatos en tabla `documento` de Supabase
    #    Estado 'subido' (id=1): único estado válido para documentos.
    #    Los estados 'activo' (id=2) e 'inactivo' (id=3) son exclusivos de usuarios.
    documento_id = str(uuid.uuid4())
    doc_record = {
        "id": documento_id,
        "nombre_documento": nombre_documento,
        "descripcion": descripcion,
        "ruta_archivo": str(file_path),
        "id_estado": 1,  # 'subido' — estado permanente para documentos
        "id_usuario": current_user["user_id"],
        "id_carrera": id_carrera,
        "id_tipo_documento": id_tipo_documento,
    }

    insert_result = db.table("documento").insert(doc_record).execute()
    if not insert_result.data:
        file_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al registrar el documento en la base de datos.",
        )

    # 5. Dejar la indexación en segundo plano y responder de inmediato
    INGEST_JOBS[documento_id] = {
        "document_id": documento_id,
        "nombre_documento": nombre_documento,
        "estado": "procesando",
        "nodes_indexed": None,
        "error": None,
        "duracion_s": None,
    }
    document_metadata = {
        "nombre_documento": nombre_documento,
        "id_carrera": id_carrera,
        "uploaded_by": current_user["email"],
    }
    background_tasks.add_task(_run_ingest, file_path, documento_id, document_metadata)

    return {
        "message": "Documento recibido. La indexación continúa en segundo plano.",
        "document_id": documento_id,
        "nombre_documento": nombre_documento,
        "estado": "procesando",
    }


@router.get("/status/{document_id}")
async def get_ingest_status(document_id: str, current_user: dict = Depends(require_admin)):
    """Estado de indexación de un documento subido en esta sesión del servidor."""
    job = INGEST_JOBS.get(document_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No hay una indexación registrada para ese documento.",
        )
    return job


@router.get("/jobs")
async def list_ingest_jobs(current_user: dict = Depends(require_admin)):
    """Lista las indexaciones registradas desde que se inició el servidor."""
    jobs = list(INGEST_JOBS.values())
    return {
        "procesando": sum(j["estado"] == "procesando" for j in jobs),
        "errores": sum(j["estado"] == "error" for j in jobs),
        "jobs": jobs,
    }
