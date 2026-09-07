/**
 * Cliente de Supabase para el frontend.
 * Usa las variables de entorno públicas (VITE_) definidas en .env.local
 *
 * Este cliente se usa para:
 *   - Autenticación (sign in, sign up, sign out)
 *   - Obtener la sesión activa y el JWT para enviarlo al backend
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Faltan las variables de entorno VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. " +
      "Crea un archivo .env.local basado en .env.example."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
