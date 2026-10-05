"""
Servicio RAG principal - Orquestado con LlamaIndex 0.14.x.
Gestiona:
  - Extracción de texto por tipo de archivo (PDF, DOCX, XLSX, CSV, TXT)
  - Limpieza del texto extraído antes de segmentarlo
  - Embeddings con Google Gemini (models/gemini-embedding-2, 3072 dims)
  - Rate-limiting en ingesta para no superar cuota gratuita de Gemini
  - LLM dinámico con Groq (selección de modelo por solicitud)
  - Enrutamiento por puntaje de similitud: si ningún fragmento supera el
    umbral, se responde con conocimiento general y se avisa al usuario
"""
import asyncio
import csv
import logging
import re
import unicodedata
from collections import Counter
from pathlib import Path
from typing import List, Optional

from llama_index.core import (
    PromptTemplate,
    Settings as LlamaSettings,
    StorageContext,
    VectorStoreIndex,
    get_response_synthesizer,
)
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import Document, NodeWithScore
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

# ─────────────────────────────────────────────
# Catálogo único de modelos LLM disponibles en Groq.
# Es la única fuente de verdad: el router y el frontend leen de aquí.
# extra_kwargs se envía tal cual a la API de Groq.
#   - Qwen 3.6 tiene modo de razonamiento; "hidden" evita que el texto
#     de razonamiento (<think>...</think>) aparezca en la respuesta.
# ─────────────────────────────────────────────
LLM_MODELS = {
    "qwen/qwen3.6-27b": {
        "label": "Qwen 3.6 27B (Groq)",
        "extra_kwargs": {"reasoning_format": "hidden"},
    },
    "openai/gpt-oss-20b": {
        "label": "GPT-OSS 20B (Groq)",
        "extra_kwargs": {},
    },
}
DEFAULT_MODEL = "qwen/qwen3.6-27b"
ALLOWED_MODELS = set(LLM_MODELS)

# ─────────────────────────────────────────────
# Prompts
# ─────────────────────────────────────────────
QA_PROMPT = PromptTemplate(
    "Eres el asistente académico de la carrera de Diseño y Desarrollo de "
    "Software de Tecsup. Responde en español usando únicamente la información "
    "de los fragmentos de documentos oficiales que aparecen abajo.\n"
    "Si los fragmentos no alcanzan para responder la pregunta completa, dilo "
    "con claridad en lugar de completar con suposiciones.\n"
    "---------------------\n"
    "{context_str}\n"
    "---------------------\n"
    "Pregunta: {query_str}\n"
    "Respuesta:"
)

FALLBACK_PROMPT = (
    "Eres el asistente académico de la carrera de Diseño y Desarrollo de "
    "Software de Tecsup. La base de documentos oficiales no tiene información "
    "sobre la siguiente pregunta. Responde en español con tu conocimiento "
    "general, de forma breve. Si la pregunta trata de datos propios de Tecsup "
    "(horarios, docentes, notas, trámites, fechas), no inventes datos: indica "
    "que esa información debe consultarse con la coordinación de la carrera.\n\n"
    "Pregunta: {query}\n"
    "Respuesta:"
)

FALLBACK_NOTICE = (
    "> No encontré información sobre esta consulta en los documentos "
    "académicos cargados. La respuesta siguiente proviene del conocimiento "
    "general del modelo y no de documentos oficiales.\n\n"
)


# ─────────────────────────────────────────────
# Inicialización del embedding model en LlamaIndex Settings global
# ─────────────────────────────────────────────
def init_rag_settings() -> None:
    """
    Configura el modelo de embeddings Gemini como predeterminado global
    de LlamaIndex. Se llama UNA SOLA VEZ desde el lifespan de FastAPI (main.py).
    El LLM NO se fija de forma global: se crea en cada consulta y se pasa
    explícitamente, para que dos usuarios con modelos distintos no se pisen.
    """
    LlamaSettings.embed_model = GeminiEmbedding(
        model_name="models/gemini-embedding-2",
        api_key=settings.gemini_api_key,
    )
    LlamaSettings.llm = None
    logger.info("✅ Gemini embedding model inicializado: models/gemini-embedding-2")


# ─────────────────────────────────────────────
# Limpieza de texto
# ─────────────────────────────────────────────
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏﻿]")
_PAGE_NUMBER = re.compile(r"^(p[áa]g(ina)?\.?\s*)?\d{1,4}(\s*(de|/)\s*\d{1,4})?$", re.IGNORECASE)
_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")
_MULTI_SPACE = re.compile(r"[ \t ]{2,}")
_MULTI_NEWLINE = re.compile(r"\n{3,}")


def _repeated_page_lines(pages: List[str]) -> set:
    """
    Detecta encabezados y pies de página: líneas cortas que se repiten en
    al menos la mitad de las páginas de un PDF (mínimo 3 páginas).
    """
    if len(pages) < 3:
        return set()
    counts = Counter()
    for page in pages:
        lines = {ln.strip() for ln in page.splitlines() if 0 < len(ln.strip()) <= 100}
        counts.update(lines)
    limit = max(2, len(pages) // 2)
    return {line for line, n in counts.items() if n >= limit}


def clean_text(text: str, pages: Optional[List[str]] = None) -> str:
    """
    Limpia el texto extraído antes de segmentarlo:
      1. Normaliza unicode (NFKC) y elimina caracteres de control o invisibles.
      2. Quita encabezados/pies repetidos y números de página (solo PDF).
      3. Une palabras cortadas con guion al final de línea.
      4. Colapsa espacios repetidos y saltos de línea excesivos.
    """
    text = unicodedata.normalize("NFKC", text)
    text = _CONTROL_CHARS.sub("", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    repeated = _repeated_page_lines(pages) if pages else set()
    lines = []
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped in repeated:
            continue
        if pages and _PAGE_NUMBER.match(stripped):
            continue
        lines.append(line.rstrip())
    text = "\n".join(lines)

    text = _HYPHEN_BREAK.sub(r"\1\2", text)
    text = _MULTI_SPACE.sub(" ", text)
    text = _MULTI_NEWLINE.sub("\n\n", text)
    return text.strip()


# ─────────────────────────────────────────────
# Extracción de texto por tipo de archivo
# ─────────────────────────────────────────────
def _extract_text_from_file(file_path: str) -> str:
    """
    Extrae el texto plano de un archivo según su extensión y lo limpia.
    Parsers utilizados:
      .pdf   → pypdf
      .docx  → python-docx
      .xlsx  → openpyxl
      .csv   → csv (stdlib)
      .txt   → open() directo
    """
    path = Path(file_path)
    ext = path.suffix.lower()
    logger.info(f"📂 Extrayendo texto de '{path.name}' (tipo: {ext})")

    if ext == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(file_path)
        pages = [page.extract_text() or "" for page in reader.pages]
        pages = [p for p in pages if p.strip()]
        logger.info(f"   PDF: {len(reader.pages)} páginas extraídas.")
        return clean_text("\n\n".join(pages), pages=pages)

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
        logger.info(f"   DOCX: {len(paragraphs)} párrafos/filas extraídos.")
        return clean_text("\n".join(paragraphs))

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
        logger.info(f"   XLSX: {len(rows_text)} filas extraídas.")
        return clean_text("\n".join(rows_text))

    elif ext == ".csv":
        rows_text = []
        with open(file_path, newline="", encoding="utf-8-sig", errors="ignore") as f:
            reader = csv.reader(f)
            for row in reader:
                row_str = " | ".join(cell for cell in row if cell.strip())
                if row_str:
                    rows_text.append(row_str)
        logger.info(f"   CSV: {len(rows_text)} filas extraídas.")
        return clean_text("\n".join(rows_text))

    elif ext == ".txt":
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
        logger.info(f"   TXT: {len(text)} caracteres extraídos.")
        return clean_text(text)

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
    Carga, limpia, segmenta e indexa un documento en Qdrant.
    Pipeline:
      1. Extracción y limpieza de texto (por tipo de archivo)
      2. Segmentación en chunks (SentenceSplitter)
      3. Vectorización + indexación en lotes con pausa (rate-limit Gemini)

    Las llamadas a Gemini y Qdrant son bloqueantes, así que se ejecutan en
    un hilo aparte para no congelar el servidor mientras se indexa.
    Retorna el número de chunks (nodos) indexados.
    """
    logger.info(f"📄 Iniciando ingesta: {file_path}")

    # 1. Extraer y limpiar texto
    raw_text = await asyncio.to_thread(_extract_text_from_file, file_path)

    if not raw_text.strip():
        raise ValueError(f"No se pudo extraer texto del archivo: {file_path}")

    # 2. Crear documento LlamaIndex con metadatos enriquecidos
    # id_ = ID de Supabase: LlamaIndex lo guarda en Qdrant como document_id /
    # ref_doc_id, así las fuentes citadas apuntan al registro real y el
    # documento se puede borrar de Qdrant por ese mismo ID.
    base_metadata = dict(document_metadata or {})
    base_metadata["document_id"] = document_id
    document = Document(id_=document_id, text=raw_text, metadata=base_metadata)

    # 3. Parsear en chunks
    parser = SentenceSplitter(chunk_size=512, chunk_overlap=64)
    nodes = parser.get_nodes_from_documents([document])
    total_nodes = len(nodes)
    logger.info(f"📦 {total_nodes} chunks generados de '{Path(file_path).name}'")

    # 4. Indexar en lotes con pausa (rate-limiting Gemini)
    storage_context = _get_storage_context()
    indexed_count = 0
    total_batches = (total_nodes + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_num, batch_start in enumerate(range(0, total_nodes, BATCH_SIZE), start=1):
        batch = nodes[batch_start: batch_start + BATCH_SIZE]
        logger.info(f"🔄 Lote {batch_num}/{total_batches} — {len(batch)} nodos...")

        await asyncio.to_thread(
            VectorStoreIndex,
            nodes=batch,
            storage_context=storage_context,
            show_progress=False,
        )
        indexed_count += len(batch)

        if batch_start + BATCH_SIZE < total_nodes:
            logger.info(f"⏳ Esperando {BATCH_DELAY_SEC}s (rate-limit Gemini)...")
            await asyncio.sleep(BATCH_DELAY_SEC)

    logger.info(f"✅ Ingesta finalizada: {indexed_count} nodos en Qdrant.")
    return indexed_count


def delete_document_vectors(document_id: str) -> None:
    """Elimina de Qdrant los vectores de un documento (útil si la ingesta falla a medias)."""
    _get_vector_store().delete(ref_doc_id=document_id)


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
        additional_kwargs=LLM_MODELS[model_name]["extra_kwargs"],
    )


def _format_sources(nodes: List[NodeWithScore]) -> list:
    return [
        {
            "document_id": node.metadata.get("document_id", "N/A"),
            "nombre_documento": node.metadata.get("nombre_documento", "N/A"),
            "score": round(node.score, 4) if node.score is not None else None,
            "texto_fragmento": node.get_content()[:300],
        }
        for node in nodes
    ]


def route_by_similarity(nodes: List[NodeWithScore], threshold: float):
    """
    Enrutamiento por puntaje de similitud.
    Retorna (nodos_relevantes, score_maximo). Si ningún nodo alcanza el
    umbral, la lista viene vacía y la consulta se responde sin contexto.
    """
    scores = [n.score for n in nodes if n.score is not None]
    max_score = max(scores) if scores else None
    relevant = [n for n in nodes if n.score is not None and n.score >= threshold]
    return relevant, max_score


# ─────────────────────────────────────────────
# Consulta RAG
# ─────────────────────────────────────────────
def _run_query(prompt: str, model_name: str, similarity_top_k: int) -> dict:
    """Parte bloqueante de la consulta; se ejecuta en un hilo aparte."""
    llm = _build_groq_llm(model_name)
    threshold = settings.similarity_threshold

    # 1. Recuperar los fragmentos más parecidos
    retriever = _load_index_from_qdrant().as_retriever(similarity_top_k=similarity_top_k)
    retrieved = retriever.retrieve(prompt)

    # 2. Enrutar según el puntaje
    relevant, max_score = route_by_similarity(retrieved, threshold)
    logger.info(
        f"📊 Score máximo={max_score} | umbral={threshold} | "
        f"fragmentos sobre el umbral={len(relevant)}/{len(retrieved)}"
    )

    if relevant:
        # 3a. Hay contexto oficial: respuesta basada en documentos
        synthesizer = get_response_synthesizer(
            llm=llm,
            text_qa_template=QA_PROMPT,
            response_mode="compact",
        )
        response = synthesizer.synthesize(prompt, nodes=relevant)
        return {
            "response": str(response),
            "sources": _format_sources(relevant),
            "model_used": model_name,
            "uso_contexto": True,
            "max_score": max_score,
            "umbral": threshold,
        }

    # 3b. Sin contexto suficiente: conocimiento general con aviso fijo
    completion = llm.complete(FALLBACK_PROMPT.format(query=prompt))
    return {
        "response": FALLBACK_NOTICE + completion.text.strip(),
        "sources": [],
        "model_used": model_name,
        "uso_contexto": False,
        "max_score": max_score,
        "umbral": threshold,
    }


async def query_rag(
    prompt: str,
    model_name: str,
    similarity_top_k: int = 5,
) -> dict:
    """
    Pipeline RAG completo:
      1. Recupera chunks de Qdrant usando embeddings Gemini.
      2. Compara el score máximo con el umbral configurado.
      3. Si supera el umbral, genera la respuesta con esos fragmentos;
         si no, responde con conocimiento general y lo indica al usuario.

    Retorna: response, sources, model_used, uso_contexto, max_score, umbral.
    """
    logger.info(f"🔍 RAG Query | model={model_name} | prompt='{prompt[:80]}...'")
    return await asyncio.to_thread(_run_query, prompt, model_name, similarity_top_k)
