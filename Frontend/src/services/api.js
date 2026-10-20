/**
 * Instancia de Axios configurada para comunicarse con el backend FastAPI.
 *
 * Interceptor automático:
 *   Antes de cada request, obtiene la sesión activa de Supabase y adjunta
 *   el JWT como header `Authorization: Bearer <access_token>`.
 *   Esto garantiza que todos los endpoints protegidos del backend puedan
 *   validar la sesión del usuario sin intervención manual.
 */
import axios from "axios";
import { supabase } from "../lib/supabaseClient";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// ── Interceptor de REQUEST ───────────────────────────────────────────────────
apiClient.interceptors.request.use(
  async (config) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      config.headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// ── Interceptor de RESPONSE ──────────────────────────────────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Si el backend retorna 401, la sesión expiró → cerrar sesión
    if (error.response?.status === 401) {
      await supabase.auth.signOut();
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

// ── Funciones helper para los endpoints ─────────────────────────────────────

/**
 * Enviar consulta RAG al backend.
 * @param {string} prompt - Pregunta del usuario
 * @param {string} modelName - ID del modelo LLM (lista en GET /api/v1/chat/models)
 * @param {number} similarityTopK - Número de fragmentos a recuperar (default 5)
 */
export const sendChatQuery = (prompt, modelName, similarityTopK = 5) =>
  apiClient.post("/api/v1/chat/query", {
    prompt,
    // Si no hay modelo elegido, el backend usa su modelo por defecto
    ...(modelName ? { model_name: modelName } : {}),
    similarity_top_k: similarityTopK,
  });

/**
 * Consulta RAG con la respuesta en streaming: el texto llega por partes.
 * Usa fetch en vez de axios porque axios no entrega la respuesta a trozos en
 * el navegador. El backend manda una línea JSON por evento (meta, delta,
 * done o error) y cada una se pasa a onEvent.
 * @param {string} prompt - Pregunta del usuario
 * @param {string} modelName - ID del modelo (vacío = el del backend)
 * @param {(evento: object) => void} onEvent - Recibe cada evento
 * @param {AbortSignal} [signal] - Para cancelar la consulta
 */
export async function streamChatQuery(prompt, modelName, onEvent, signal) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  let res;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/chat/query/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        prompt,
        ...(modelName ? { model_name: modelName } : {}),
        similarity_top_k: 5,
      }),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("No se pudo conectar con el servidor. Revisa que el backend esté encendido.");
  }

  if (res.status === 401) {
    await supabase.auth.signOut();
    window.location.href = "/login";
    throw new Error("Tu sesión expiró.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).detail;
    } catch {
      /* respuesta sin JSON (por ejemplo, el proxy sin backend) */
    }
    if (!detail && res.status >= 502) {
      detail = "No se pudo conectar con el servidor. Revisa que el backend esté encendido.";
    }
    throw new Error(detail || `Error ${res.status} al procesar la consulta.`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let salto;
    while ((salto = buffer.indexOf("\n")) >= 0) {
      const linea = buffer.slice(0, salto).trim();
      buffer = buffer.slice(salto + 1);
      if (linea) onEvent(JSON.parse(linea));
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

/**
 * Historial de consultas del usuario autenticado.
 * @param {number} limit - Cantidad máxima de consultas a traer
 */
export const getChatHistory = (limit = 20) =>
  apiClient.get("/api/v1/chat/history", { params: { limit } });

/**
 * Fijar o desfijar una consulta del historial.
 * @param {string} consultaId - ID de la consulta
 * @param {boolean} fijada - true para fijarla arriba
 */
export const pinHistoryItem = (consultaId, fijada) =>
  apiClient.patch(`/api/v1/chat/history/${consultaId}`, { fijada });

/**
 * Borrar consultas del historial.
 * @param {{ids?: string[], todas?: boolean}} opciones - ids elegidos, o todas=true
 *   para borrar todo el historial (las fijadas se conservan)
 */
export const deleteHistory = (opciones) =>
  apiClient.post("/api/v1/chat/history/delete", opciones);

/**
 * Obtener modelos LLM disponibles del backend.
 */
export const getAvailableModels = () =>
  apiClient.get("/api/v1/chat/models");

/**
 * Subir un documento para ingesta RAG.
 * Usa multipart/form-data — Axios ajusta el Content-Type automáticamente.
 * @param {FormData} formData - Datos del formulario con el archivo y metadatos
 */
export const uploadDocument = (formData) =>
  apiClient.post("/api/v1/ingest/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

/**
 * Subir una versión nueva de un documento existente.
 * La anterior se elimina cuando la nueva termina de indexarse.
 * @param {string} documentId - ID del documento a reemplazar
 * @param {FormData} formData - Datos con el archivo nuevo (y opcionalmente nombre o descripción)
 */
export const replaceDocument = (documentId, formData) =>
  apiClient.post(`/api/v1/ingest/documents/${documentId}/replace`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

/**
 * Cambiar el nombre, la descripción o la carrera de un documento ya subido.
 * @param {string} documentId - ID del documento
 * @param {{nombre_documento?: string, descripcion?: string, id_carrera?: number}} cambios
 */
export const updateDocument = (documentId, cambios) =>
  apiClient.patch(`/api/v1/ingest/documents/${documentId}`, cambios);

/**
 * Descargar el archivo original de un documento.
 * Se pide como blob porque el endpoint exige el token de sesión.
 * @param {string} documentId - ID del documento
 */
export const downloadDocument = (documentId) =>
  apiClient.get(`/api/v1/ingest/documents/${documentId}/download`, { responseType: "blob" });

/**
 * Eliminar un documento (registro, vectores y archivo).
 * @param {string} documentId - ID del documento
 */
export const deleteDocument = (documentId) =>
  apiClient.delete(`/api/v1/ingest/documents/${documentId}`);

/**
 * Estado de indexación de un documento (en cola / procesando / indexado / error).
 * @param {string} documentId - ID devuelto por uploadDocument
 */
export const getIngestStatus = (documentId) =>
  apiClient.get(`/api/v1/ingest/status/${documentId}`);

/**
 * Resumen de indexaciones del servidor (contadores del panel).
 */
export const getIngestJobs = () =>
  apiClient.get("/api/v1/ingest/jobs");

export default apiClient;
