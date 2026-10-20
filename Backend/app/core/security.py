"""
Seguridad y autenticación.
Valida los tokens JWT en el propio backend, sin llamar a Supabase en cada
consulta:
  - Proyectos con JWT Signing Keys (ES256 o RS256): se verifica la firma con
    las llaves públicas del proyecto (JWKS), que se descargan una vez y se
    guardan una hora en memoria.
  - Proyectos con el secreto antiguo (HS256): se verifica con SUPABASE_JWT_SECRET.
Si la verificación local no es posible (por ejemplo, no se pudieron bajar las
llaves), se usa la API de Supabase Auth (auth.get_user) como respaldo.

Nota: al validar localmente, un token sigue siendo válido hasta que expira
(1 hora por defecto) aunque el usuario cierre sesión en otro dispositivo.

Roles definidos en la tabla `rol` de Supabase:
  id=1  alumno
  id=2  profesor
  id=3  admin
"""
import logging
import time

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from app.core.config import settings

logger = logging.getLogger(__name__)

# Scheme HTTP Bearer para leer el token del header Authorization
bearer_scheme = HTTPBearer()

# IDs de rol según la tabla `rol` en Supabase
ROL_ALUMNO = 1
ROL_PROFESOR = 2
ROL_ADMIN = 3


# ─────────────────────────────────────────────
# Verificación local del JWT
# ─────────────────────────────────────────────
_ALGORITMOS = {"ES256", "RS256", "HS256"}
_JWKS_TTL_SEC = 3600
_jwks_cache = {"momento": 0.0, "llaves": {}}


class _NoVerificable(Exception):
    """No se puede verificar el token localmente; hay que preguntar a Supabase."""


def _issuer() -> str:
    return settings.supabase_url.rstrip("/") + "/auth/v1"


def _llaves_publicas(forzar: bool = False) -> dict:
    """Llaves públicas del proyecto (JWKS), indexadas por kid."""
    vigente = time.monotonic() - _jwks_cache["momento"] < _JWKS_TTL_SEC
    if _jwks_cache["llaves"] and vigente and not forzar:
        return _jwks_cache["llaves"]
    try:
        r = httpx.get(_issuer() + "/.well-known/jwks.json", timeout=5)
        r.raise_for_status()
        llaves = {k["kid"]: k for k in r.json().get("keys", []) if k.get("kid")}
    except Exception as e:
        raise _NoVerificable(f"no se pudieron obtener las llaves públicas: {e}")
    _jwks_cache.update(momento=time.monotonic(), llaves=llaves)
    return llaves


def _verificar_local(token: str) -> dict:
    """
    Verifica firma, expiración, audiencia y emisor del token.
    Lanza JWTError si el token es inválido o expiró, y _NoVerificable si no
    hay con qué verificarlo.
    """
    header = jwt.get_unverified_header(token)
    alg = header.get("alg")
    if alg not in _ALGORITMOS:
        raise JWTError(f"Algoritmo no permitido: {alg}")

    if alg == "HS256":
        if not settings.supabase_jwt_secret:
            raise _NoVerificable("falta SUPABASE_JWT_SECRET")
        llave = settings.supabase_jwt_secret
    else:
        kid = header.get("kid")
        llaves = _llaves_publicas()
        if kid not in llaves:
            # Puede que el proyecto haya rotado sus llaves: se vuelven a pedir
            llaves = _llaves_publicas(forzar=True)
        if kid not in llaves:
            raise _NoVerificable(f"llave {kid} desconocida")
        llave = llaves[kid]

    claims = jwt.decode(token, llave, algorithms=[alg], audience="authenticated", issuer=_issuer())
    return {
        "user_id": claims["sub"],
        "email": claims.get("email"),
        "role": claims.get("role") or "authenticated",
    }


def _verificar_con_supabase(token: str) -> dict:
    """Respaldo: valida el token llamando a Supabase Auth (un viaje de red)."""
    # Import lazy para evitar circular imports al cargar el módulo
    from app.db.supabase_client import get_supabase_client

    user = get_supabase_client().auth.get_user(token).user
    if not user:
        raise JWTError("Token inválido o expirado.")
    return {
        "user_id": str(user.id),
        "email": user.email,
        "role": user.role or "authenticated",
    }


def _no_autorizado(detalle: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detalle,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """
    Dependencia de FastAPI.
    Valida el token JWT (localmente, o con Supabase Auth si no se puede).
    Retorna user_id, email, role y auth_ms (lo que tardó la validación).
    Uso: endpoints accesibles por cualquier usuario autenticado (chat).
    """
    token = credentials.credentials
    inicio = time.perf_counter()
    try:
        try:
            usuario = _verificar_local(token)
        except _NoVerificable as e:
            logger.warning(f"⚠️ Validación local del token no disponible ({e}); se usa Supabase Auth")
            usuario = _verificar_con_supabase(token)
    except JWTError as e:
        raise _no_autorizado(f"Token inválido o expirado: {e}")
    except Exception as e:
        raise _no_autorizado(f"Token inválido o expirado: {str(e)}")
    usuario["auth_ms"] = int((time.perf_counter() - inicio) * 1000)
    return usuario


def get_current_user_with_role(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Dependencia de FastAPI.
    Extiende get_current_user consultando la tabla `usuario` en Supabase
    para obtener el rol_id de negocio real (alumno/profesor/admin).
    Retorna el usuario con el campo `rol_id` añadido.
    """
    from app.db.supabase_client import get_supabase_client

    db = get_supabase_client()
    result = (
        db.table("usuario")
        .select("rol_id")
        .eq("id", current_user["user_id"])
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado en la base de datos.",
        )

    return {**current_user, "rol_id": result.data["rol_id"]}


def require_admin(
    current_user: dict = Depends(get_current_user_with_role),
) -> dict:
    """
    Dependencia de FastAPI.
    Permite el acceso ÚNICAMENTE a usuarios con rol 'admin' (rol_id=3).
    Usar en endpoints exclusivos del administrador (ingesta de documentos).
    Lanza HTTP 403 para alumnos y profesores.
    """
    if current_user.get("rol_id") != ROL_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso denegado: se requiere rol de administrador.",
        )
    return current_user
