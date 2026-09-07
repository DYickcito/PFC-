"""
Router de ingesta de documentos.

Endpoints:
  POST /api/v1/ingest/upload
    - Recibe un archivo (PDF, TXT, DOCX, CSV, XLSX)
    - Guarda el archivo en disco
    - Registra metadatos en la tabla `documento` de Supabase
    - Inicia la ingesta asíncrona con LlamaIndex + Gemini Embeddings → Qdrant
"""
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
import aiofiles

from app.core.config import settings
from app.core.security import require_admin
from app.db.supabase_client import get_supabase_client
from app.services.rag_service import ingest_document

router = APIRouter(prefix="/api/v1/ingest", tags=["Ingesta"])

# Tipos de archivo permitidos (coinciden con tabla tipo_documento)
ALLOWED_MIME = {
    "application/pdf": "PDF",
    "text/plain": "Txt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
    "text/csv": "CSV",
}


@router.post("/upload", status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    file: UploadFile = File(...),
    nombre_documento: str = Form(...),
    descripcion: str = Form(""),
    id_carrera: int = Form(...),
    current_user: dict = Depends(require_admin),
):
    """
    Sube e indexa un documento institucional.

    - **file**: Archivo a cargar (PDF, TXT, DOCX, CSV, XLSX).
    - **nombre_documento**: Nombre descriptivo del documento.
    - **descripcion**: Descripción opcional del contenido.
    - **id_carrera**: ID de la carrera asociada (tabla `carrera`).

    Requiere token JWT válido de un usuario con rol **admin**.
    Alumnos y profesores recibirán HTTP 403.
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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al registrar el documento en la base de datos.",
        )

    # 5. Iniciar ingesta RAG (embeddings + Qdrant)
    document_metadata = {
        "nombre_documento": nombre_documento,
        "id_carrera": id_carrera,
        "uploaded_by": current_user["email"],
    }
    nodes_indexed = await ingest_document(
        file_path=str(file_path),
        document_id=documento_id,
        document_metadata=document_metadata,
    )

    return {
        "message": "Documento ingresado exitosamente.",
        "document_id": documento_id,
        "nombre_documento": nombre_documento,
        "nodes_indexed": nodes_indexed,
    }

