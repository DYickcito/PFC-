"""
Seguridad y autenticación.
Valida los tokens JWT a través de la API de Supabase Auth (auth.get_user),
lo que es compatible con HS256 (legacy) y RS256 (nuevas JWT Signing Keys).

Roles definidos en la tabla `rol` de Supabase:
  id=1  alumno
  id=2  profesor
  id=3  admin
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# Scheme HTTP Bearer para leer el token del header Authorization
bearer_scheme = HTTPBearer()

# IDs de rol según la tabla `rol` en Supabase
ROL_ALUMNO = 1
ROL_PROFESOR = 2
ROL_ADMIN = 3


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """
    Dependencia de FastAPI.
    Valida el token JWT llamando a Supabase Auth (auth.get_user).
    Compatible con proyectos Supabase que usan las nuevas JWT Signing Keys (RS256).
    Retorna user_id, email y role del usuario autenticado.
    Uso: endpoints accesibles por cualquier usuario autenticado (chat).
    """
    # Import lazy para evitar circular imports al cargar el módulo
    from app.db.supabase_client import get_supabase_client

    token = credentials.credentials
    try:
        db = get_supabase_client()
        response = db.auth.get_user(token)
        user = response.user

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token inválido o expirado.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return {
            "user_id": str(user.id),
            "email": user.email,
            "role": user.role or "authenticated",
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token inválido o expirado: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )


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
