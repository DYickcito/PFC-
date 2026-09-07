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

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8000",
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
 * @param {string} modelName - Modelo LLM seleccionado (qwen/qwen3-27b u openai/gpt-oss-20b)
 * @param {number} similarityTopK - Número de fragmentos a recuperar (default 5)
 */
export const sendChatQuery = (prompt, modelName, similarityTopK = 5) =>
  apiClient.post("/api/v1/chat/query", {
    prompt,
    model_name: modelName,
    similarity_top_k: similarityTopK,
  });

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

export default apiClient;
