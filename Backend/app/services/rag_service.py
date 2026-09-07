"""
Servicio RAG principal - Orquestado con LlamaIndex 0.14.x.
Gestiona:
  - Extracción de texto por tipo de archivo (PDF, DOCX, XLSX, CSV, TXT)
  - Embeddings con Google Gemini (models/gemini-embedding-2, 3072 dims)
  - Rate-limiting en ingesta para no superar cuota gratuita de Gemini
  - LLM dinámico con Groq (selección de modelo por solicitud)
  - Indexado y consulta RAG contra Qdrant
"""
import asyncio
import csv
import logging
from pathlib import Path
from typing import List, Optional

from llama_index.core import (
    Settings as LlamaSettings,
    StorageContext,
    VectorStoreIndex,
)
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import Document
from llama_index.embeddings.gemini import GeminiEmbedding
from llama_index.llms.groq import Groq
from llama_index.vector_stores.qdrant import QdrantVectorStore

from app.core.config import settings
from app.db.qdrant_setup import qdrant_client

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Constantes de rate-limiting (Gemini Free Tier)
# ~5 req/min → esperamos 12s entre lotes de 5 nodos
# ─────────────────────────────────────────────
BATCH_SIZE = 5
BATCH_DELAY_SEC = 12.0

# Modelos LLM permitidos (recibidos dinámicamente desde el frontend)
ALLOWED_MODELS = {"qwen/qwen3-27b", "openai/gpt-oss-20b"}


# ─────────────────────────────────────────────
# Inicialización del embedding model en LlamaIndex Settings global
# ─────────────────────────────────────────────
def init_rag_settings() -> None:
    """
    Configura el modelo de embeddings Gemini como predeterminado global
    de LlamaIndex. Se llama UNA SOLA VEZ desde el lifespan de FastAPI (main.py).
    La API de llama-index 0.14.x usa Settings directamente.
    """
    LlamaSettings.embed_model = GeminiEmbedding(
        model_name="models/gemini-embedding-2",
        api_key=settings.gemini_api_key,
    )
    # Desactivar LLM por defecto (se asigna por-request en query_rag)
    LlamaSettings.llm = None
    logger.info("✅ Gemini embedding model inicializado: models/gemini-embedding-2")


# ─────────────────────────────────────────────
# Extracción de texto por tipo de archivo
# ─────────────────────────────────────────────
def _extract_text_from_file(file_path: str) -> str:
    """
    Extrae el texto plano de un archivo según su extensión.
    Usa los parsers ya instalados en el entorno:
      .pdf   → pypdf
      .docx  → python-docx
      .xlsx  → openpyxl
      .csv   → csv (stdlib)
      .txt   → open() directo

    Retorna el texto completo como string para que LlamaIndex
    pueda segmentarlo y vectorizarlo correctamente.
    """
    path = Path(file_path)
    ext = path.suffix.lower()
    logger.info(f"📂 Extrayendo texto de '{path.name}' (tipo: {ext})")

    if ext == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(file_path)
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n\n".join(p for p in pages if p.strip())
        logger.info(f"   PDF: {len(reader.pages)} páginas extraídas.")
        return text

    elif ext == ".docx":
        from docx import Document as DocxDocument
        doc = DocxDocument(file_path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        # También extraer texto de tablas
        for table in doc.tables:
            for row in table.rows:
                row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                if row_text:
                    paragraphs.append(row_text)
        text = "\n".join(paragraphs)
        logger.info(f"   DOCX: {len(paragraphs)} párrafos/filas extraídos.")
        return text

    elif ext in (".xlsx", ".xls"):
        import openpyxl
        wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
        rows_text = []
        for sheet in wb.worksheets:
            rows_text.append(f"[Hoja: {sheet.title}]")
            for row in sheet.iter_rows(values_only=True):
                row_str = " | ".join(str(v) for v in row if v is not None)
                if row_str.strip():
                    rows_text.append(row_str)
        text = "\n".join(rows_text)
        logger.info(f"   XLSX: {len(rows_text)} filas extraídas.")
        return text

    elif ext == ".csv":
        rows_text = []
        with open(file_path, newline="", encoding="utf-8-sig", errors="ignore") as f:
            reader = csv.reader(f)
            for row in reader:
                row_str = " | ".join(cell for cell in row if cell.strip())
                if row_str:
                    rows_text.append(row_str)
        text = "\n".join(rows_text)
        logger.info(f"   CSV: {len(rows_text)} filas extraídas.")
        return text

    elif ext == ".txt":
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
        logger.info(f"   TXT: {len(text)} caracteres extraídos.")
        return text

    else:
        raise ValueError(f"Tipo de archivo no soportado para extracción: {ext}")


# ─────────────────────────────────────────────
# Helpers de Vector Store / Index
# ─────────────────────────────────────────────
def _get_vector_store() -> QdrantVectorStore:
    return QdrantVectorStore(
        client=qdrant_client,
        collection_name=settings.qdrant_collection_name,
    )


def _get_storage_context() -> StorageContext:
    return StorageContext.from_defaults(vector_store=_get_vector_store())


def _load_index_from_qdrant() -> VectorStoreIndex:
    """Carga el índice existente desde Qdrant sin re-indexar."""
    return VectorStoreIndex.from_vector_store(
        vector_store=_get_vector_store(),
    )


# ─────────────────────────────────────────────
# Ingesta de Documentos con Rate-Limiting
# ─────────────────────────────────────────────
async def ingest_document(
    file_path: str,
    document_id: str,
    document_metadata: Optional[dict] = None,
) -> int:
    """
    Carga, parsea e indexa un documento en Qdrant.
    Pipeline:
      1. Extracción de texto (por tipo de archivo)
      2. Segmentación en chunks (SentenceSplitter)
      3. Vectorización + indexación en lotes con delay (rate-limit Gemini)

    Retorna el número de chunks (nodos) indexados.
    """
    logger.info(f"📄 Iniciando ingesta: {file_path}")

    # 1. Extraer texto del archivo usando el parser correspondiente
    raw_text = _extract_text_from_file(file_path)

    if not raw_text.strip():
        raise ValueError(f"No se pudo extraer texto del archivo: {file_path}")

    # 2. Crear documento LlamaIndex con metadatos enriquecidos
    base_metadata = document_metadata or {}
    base_metadata["document_id"] = document_id
    document = Document(text=raw_text, metadata=base_metadata)

    # 3. Parsear en chunks
    parser = SentenceSplitter(chunk_size=512, chunk_overlap=64)
    nodes = parser.get_nodes_from_documents([document])
    total_nodes = len(nodes)
    logger.info(f"📦 {total_nodes} chunks generados de '{Path(file_path).name}'")

    # 4. Indexar en lotes con delay (rate-limiting Gemini)
    storage_context = _get_storage_context()
    indexed_count = 0
    total_batches = (total_nodes + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_num, batch_start in enumerate(range(0, total_nodes, BATCH_SIZE), start=1):
        batch = nodes[batch_start: batch_start + BATCH_SIZE]
        logger.info(f"🔄 Lote {batch_num}/{total_batches} — {len(batch)} nodos...")

        # Insertar lote en Qdrant a través de LlamaIndex
        VectorStoreIndex(
            nodes=batch,
            storage_context=storage_context,
            show_progress=False,
        )
        indexed_count += len(batch)

        # Esperar entre lotes (no esperar tras el último)
        if batch_start + BATCH_SIZE < total_nodes:
            logger.info(f"⏳ Esperando {BATCH_DELAY_SEC}s (rate-limit Gemini)...")
            await asyncio.sleep(BATCH_DELAY_SEC)

    logger.info(f"✅ Ingesta finalizada: {indexed_count} nodos en Qdrant.")
    return indexed_count





# ─────────────────────────────────────────────
# LLM Groq — selección dinámica por request
# ─────────────────────────────────────────────
def _build_groq_llm(model_name: str) -> Groq:
    """Instancia el LLM Groq con el modelo especificado y validado."""
    if model_name not in ALLOWED_MODELS:
        raise ValueError(
            f"Modelo '{model_name}' no permitido. "
            f"Opciones válidas: {sorted(ALLOWED_MODELS)}"
        )
    return Groq(
        model=model_name,
        api_key=settings.groq_api_key,
        temperature=0.2,
        max_tokens=2048,
    )


# ─────────────────────────────────────────────
# Consulta RAG
# ─────────────────────────────────────────────
async def query_rag(
    prompt: str,
    model_name: str,
    similarity_top_k: int = 5,
) -> dict:
    """
    Pipeline RAG completo:
      1. Recupera chunks relevantes de Qdrant usando embeddings Gemini.
      2. Genera respuesta con Groq usando el modelo seleccionado.

    Retorna: response, sources (document_id, nombre, score, fragmento), model_used.
    """
    logger.info(f"🔍 RAG Query | model={model_name} | prompt='{prompt[:80]}...'")

    # Asignar LLM para esta petición específica
    llm = _build_groq_llm(model_name)
    LlamaSettings.llm = llm

    # Cargar índice desde Qdrant
    index = _load_index_from_qdrant()

    # Crear query engine
    query_engine = index.as_query_engine(
        similarity_top_k=similarity_top_k,
        streaming=False,
    )

    # Ejecutar en thread pool para no bloquear el event loop
    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(
        None, lambda: query_engine.query(prompt)
    )

    # Construir lista de fuentes citadas
    sources = []
    for node in getattr(response, "source_nodes", []):
        sources.append({
            "document_id": node.metadata.get("document_id", "N/A"),
            "nombre_documento": node.metadata.get("nombre_documento", "N/A"),
            "score": round(node.score, 4) if node.score is not None else None,
            "texto_fragmento": node.get_content()[:300],
        })

    return {
        "response": str(response),
        "sources": sources,
        "model_used": model_name,
    }
