"""
Cliente Supabase para el backend.
Usa la SERVICE_ROLE_KEY para operaciones privilegiadas (bypass RLS).

IMPORTANTE: El cliente se instancia de forma lazy a través de una
dependencia FastAPI, no al importar el módulo. Esto evita errores
de arranque si las credenciales aún no están configuradas.
"""
from functools import lru_cache
from supabase import create_client, Client
from app.core.config import settings


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    """
    Retorna el cliente Supabase (singleton con lru_cache).
    Se inicializa la primera vez que se llama, no al importar.
    Usar solo en el backend (nunca exponer service_role_key al frontend).
    """
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
    )
