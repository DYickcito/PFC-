"""
Router de ingesta y gestión de documentos.

Endpoints:
  POST /api/v1/ingest/upload
    - Recibe un archivo (PDF, TXT, DOCX, CSV, XLSX)
    - Guarda el archivo en disco
    - Registra metadatos en la tabla `documento` de Supabase
    - Responde de inmediato (202) y deja la indexación en segundo plano
      (extracción, limpieza, chunking, embeddings Gemini → Qdrant)

  POST /api/v1/ingest/documents/{document_id}/replace
    - Sube una versión nueva de un documento (por ejemplo, un horario actualizado)
    - La versión anterior sigue disponible para consultas hasta que la nueva
      termina de indexarse; recién entonces se elimina

  DELETE /api/v1/ingest/documents/{document_id}
    - Elimina un documento: registro en Supabase, vectores en Qdrant y archivo

  PATCH /api/v1/ingest/documents/{document_id}
    - Cambia el nombre, la descripción o la carrera de un documento ya subido

  GET /api/v1/ingest/documents/{document_id}/download
    - Descarga el archivo original del documento

  GET /api/v1/ingest/status/{document_id}
    - Estado de la indexación de un documento: en_cola / procesando / indexado / error

  GET /api/v1/ingest/jobs
    - Estado de las indexaciones desde que se inició el servidor
      (alimenta los contadores "En proceso" y "Con errores" del panel)

Se pueden subir varios documentos seguidos: cada uno entra a una cola y se
indexa de a uno, para no superar el límite de solicitudes de la capa gratuita
de Gemini (varias indexaciones en paralelo multiplicarían las llamadas).
"""
import asyncio
import logging
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
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
from app.services.rag_service import (
    delete_document_vectors,
    ingest_document,
    invalidar_catalogo,
    update_document_metadata,
)

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

EN_CURSO = ("en_cola", "procesando")

# ─────────────────────────────────────────────
# Registro en memoria del estado de cada indexación.
# Se pierde si el servidor se reinicia; para el prototipo es suficiente.
# ─────────────────────────────────────────────
INGEST_JOBS: dict[str, dict] = {}

# Solo una indexación a la vez; las demás esperan su turno en estado "en_cola".
_INGEST_LOCK = asyncio.Lock()


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────
def _ruta_segura(ruta: Optional[str]) -> Optional[Path]:
    """Ruta absoluta del archivo, solo si está dentro de la carpeta de uploads."""
    if not ruta:
        return None
    path = Path(ruta).resolve()
    if Path(settings.upload_dir).resolve() not in path.parents:
        logger.warning(f"Ruta '{ruta}' fuera de la carpeta de uploads; se ignora.")
        return None
    return path


def _borrar_archivo(ruta: Optional[str]) -> None:
    """Borra un archivo subido, solo si está dentro de la carpeta de uploads."""
    path = _ruta_segura(ruta)
    if path:
        path.unlink(missing_ok=True)


def _eliminar_documento(documento_id: str, ruta: Optional[str]) -> None:
    """
    Elimina un documento por completo: vectores en Qdrant, registro en Supabase
    y archivo en disco. Lanza la excepción si falla el borrado en Supabase,
    porque ese registro es el que ve el administrador.
    """
    try:
        delete_document_vectors(documento_id)
    except Exception:
        logger.warning(f"No se pudieron limpiar los vectores de {documento_id}")
    get_supabase_client().table("documento").delete().eq("id", documento_id).execute()
    _borrar_archivo(ruta)
    invalidar_catalogo()


def _documento_en_curso(documento_id: str) -> bool:
    """True si el documento se está indexando o tiene un reemplazo en curso."""
    return any(
        j["estado"] in EN_CURSO and documento_id in (j["document_id"], j.get("reemplaza"))
        for j in INGEST_JOBS.values()
    )


def _obtener_documento(documento_id: str) -> dict:
    result = (
        get_supabase_client()
        .table("documento")
        .select("id, nombre_documento, descripcion, ruta_archivo, id_carrera")
        .eq("id", documento_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="El documento no existe.")
    return result.data[0]


async def _registrar_y_encolar(
    background_tasks: BackgroundTasks,
    file: UploadFile,
    nombre_documento: str,
    descripcion: str,
    id_carrera: int,
    current_user: dict,
    reemplaza: Optional[dict] = None,
) -> dict:
    """
    Valida el archivo, lo guarda en disco, lo registra en Supabase y deja su
    indexación en la cola. Si `reemplaza` trae un documento, este se elimina
    cuando el nuevo termine de indexarse correctamente.
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
    tipo_result = (
        db.table("tipo_documento")
        .select("id")
        .eq("nombre_tipo", ALLOWED_MIME[file.content_type])
        .single()
        .execute()
    )
    if not tipo_result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se encontró el tipo de documento en la base de datos.",
        )

    # 3. Guardar archivo en disco
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / f"{uuid.uuid4()}{Path(file.filename).suffix}"
    async with aiofiles.open(file_path, "wb") as out_file:
        await out_file.write(await file.read())

    # 4. Registrar metadatos en tabla `documento` de Supabase
    #    Estado 'subido' (id=1): único estado válido para documentos.
    #    Los estados 'activo' (id=2) e 'inactivo' (id=3) son exclusivos de usuarios.
    documento_id = str(uuid.uuid4())
    insert_result = db.table("documento").insert({
        "id": documento_id,
        "nombre_documento": nombre_documento,
        "descripcion": descripcion,
        "ruta_archivo": str(file_path),
        "id_estado": 1,
        "id_usuario": current_user["user_id"],
        "id_carrera": id_carrera,
        "id_tipo_documento": tipo_result.data["id"],
    }).execute()
    if not insert_result.data:
        file_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al registrar el documento en la base de datos.",
        )

    # 5. Dejar la indexación en la cola y responder de inmediato
    INGEST_JOBS[documento_id] = {
        "document_id": documento_id,
        "nombre_documento": nombre_documento,
        "estado": "en_cola",
        "nodes_indexed": None,
        "error": None,
        "duracion_s": None,
        "reemplaza": reemplaza["id"] if reemplaza else None,
        "aviso": None,
    }
    document_metadata = {
        "nombre_documento": nombre_documento,
        "id_carrera": id_carrera,
        "uploaded_by": current_user["email"],
    }
    background_tasks.add_task(_run_ingest, file_path, documento_id, document_metadata, reemplaza)

    return {
        "message": "Documento recibido. Queda en cola para indexarse en segundo plano.",
        "document_id": documento_id,
        "nombre_documento": nombre_documento,
        "estado": "en_cola",
        "reemplaza": reemplaza["id"] if reemplaza else None,
    }


async def _run_ingest(
    file_path: Path,
    documento_id: str,
    document_metadata: dict,
    reemplaza: Optional[dict] = None,
) -> None:
    """Tarea en segundo plano: espera su turno en la cola y luego indexa el documento."""
    job = INGEST_JOBS[documento_id]
    async with _INGEST_LOCK:
        job["estado"] = "procesando"
        await _index_document(job, file_path, documento_id, document_metadata, reemplaza)


async def _index_document(
    job: dict,
    file_path: Path,
    documento_id: str,
    document_metadata: dict,
    reemplaza: Optional[dict] = None,
) -> None:
    """
    Indexa el documento y actualiza su estado.
    Si la indexación falla, se eliminan el registro en Supabase, los vectores
    parciales en Qdrant y el archivo, para que el historial no muestre como
    indexado un documento que no se puede consultar. Si era un reemplazo, la
    versión anterior se conserva intacta.
    Si la indexación funciona y era un reemplazo, se elimina la versión anterior.
    duracion_s mide solo la indexación, sin el tiempo de espera en la cola.
    """
    start = time.perf_counter()
    try:
        nodes_indexed = await ingest_document(
            file_path=str(file_path),
            document_id=documento_id,
            document_metadata=document_metadata,
        )
        job.update(estado="indexado", nodes_indexed=nodes_indexed)
        invalidar_catalogo()
    except Exception as e:
        logger.exception(f"❌ Falló la ingesta de {documento_id}")
        job.update(estado="error", error=str(e))
        try:
            _eliminar_documento(documento_id, str(file_path))
        except Exception:
            logger.warning(f"No se pudo eliminar el registro {documento_id} de Supabase")
        return
    finally:
        job["duracion_s"] = round(time.perf_counter() - start, 1)

    if reemplaza:
        try:
            await asyncio.to_thread(_eliminar_documento, reemplaza["id"], reemplaza.get("ruta_archivo"))
            logger.info(f"♻️ Versión anterior {reemplaza['id']} reemplazada por {documento_id}")
        except Exception as e:
            logger.warning(f"No se pudo eliminar la versión anterior {reemplaza['id']}: {e}")
            job["aviso"] = "La versión nueva quedó indexada, pero no se pudo eliminar la anterior."


# ─────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────
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
    return await _registrar_y_encolar(
        background_tasks, file, nombre_documento, descripcion, id_carrera, current_user
    )


@router.post("/documents/{document_id}/replace", status_code=status.HTTP_202_ACCEPTED)
async def replace_document(
    document_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    nombre_documento: Optional[str] = Form(None),
    descripcion: Optional[str] = Form(None),
    current_user: dict = Depends(require_admin),
):
    """
    Sube una versión nueva de un documento existente.

    El nombre, la descripción y la carrera se toman del documento anterior,
    salvo que se envíen otros. La versión anterior sigue respondiendo consultas
    hasta que la nueva termina de indexarse; si la nueva falla, la anterior se
    conserva.
    """
    if _documento_en_curso(document_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ese documento tiene una indexación o un reemplazo en curso. Espera a que termine.",
        )
    anterior = _obtener_documento(document_id)
    return await _registrar_y_encolar(
        background_tasks,
        file,
        nombre_documento or anterior["nombre_documento"],
        (anterior.get("descripcion") or "") if descripcion is None else descripcion,
        anterior["id_carrera"],
        current_user,
        reemplaza=anterior,
    )


@router.delete("/documents/{document_id}")
async def delete_document(document_id: str, current_user: dict = Depends(require_admin)):
    """
    Elimina un documento: su registro en Supabase, sus vectores en Qdrant y el
    archivo guardado. Desde ese momento deja de usarse en las respuestas.
    """
    if _documento_en_curso(document_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ese documento tiene una indexación o un reemplazo en curso. Espera a que termine.",
        )
    documento = _obtener_documento(document_id)
    try:
        await asyncio.to_thread(_eliminar_documento, document_id, documento.get("ruta_archivo"))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"No se pudo eliminar el documento: {e}",
        )
    INGEST_JOBS.pop(document_id, None)
    return {"message": "Documento eliminado.", "document_id": document_id}


class DocumentUpdate(BaseModel):
    nombre_documento: Optional[str] = Field(default=None, min_length=1, max_length=200)
    descripcion: Optional[str] = Field(default=None, max_length=500)
    id_carrera: Optional[int] = Field(default=None, ge=1)


@router.patch("/documents/{document_id}")
async def update_document(
    document_id: str,
    cambios: DocumentUpdate,
    current_user: dict = Depends(require_admin),
):
    """
    Cambia el nombre, la descripción o la carrera de un documento ya subido.
    Solo se modifican los campos enviados. El nombre y la carrera también se
    actualizan en los fragmentos guardados en Qdrant, para que las fuentes
    citadas muestren los datos nuevos. No hace falta volver a indexar.
    """
    datos = cambios.model_dump(exclude_none=True)
    if "nombre_documento" in datos:
        datos["nombre_documento"] = datos["nombre_documento"].strip()
        if not datos["nombre_documento"]:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="El nombre no puede quedar vacío.")
    if not datos:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No se envió ningún cambio.")
    if _documento_en_curso(document_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ese documento tiene una indexación o un reemplazo en curso. Espera a que termine.",
        )
    _obtener_documento(document_id)  # 404 si no existe

    try:
        get_supabase_client().table("documento").update(datos).eq("id", document_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"No se pudo actualizar el documento: {e}",
        )

    invalidar_catalogo()
    aviso = None
    para_qdrant = {k: v for k, v in datos.items() if k in ("nombre_documento", "id_carrera")}
    if para_qdrant:
        try:
            await asyncio.to_thread(update_document_metadata, document_id, para_qdrant)
        except Exception as e:
            logger.warning(f"No se pudieron actualizar los metadatos en Qdrant de {document_id}: {e}")
            aviso = "Se guardaron los cambios, pero las fuentes citadas pueden seguir mostrando los datos anteriores."

    return {"message": "Documento actualizado.", "document_id": document_id, "cambios": datos, "aviso": aviso}


@router.get("/documents/{document_id}/download")
async def download_document(document_id: str, current_user: dict = Depends(require_admin)):
    """Descarga el archivo original de un documento, con su nombre descriptivo."""
    documento = _obtener_documento(document_id)
    path = _ruta_segura(documento.get("ruta_archivo"))
    if not path or not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El archivo de este documento ya no está en el servidor.",
        )
    nombre = documento["nombre_documento"]
    if not nombre.lower().endswith(path.suffix.lower()):
        nombre += path.suffix
    return FileResponse(path, filename=nombre)


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
        "en_cola": sum(j["estado"] == "en_cola" for j in jobs),
        "procesando": sum(j["estado"] == "procesando" for j in jobs),
        "errores": sum(j["estado"] == "error" for j in jobs),
        "jobs": jobs,
    }
