"""Autorización del backend a partir de registros administrados en Firestore."""
from urllib.parse import quote

import requests

PROJECT = "cicsa-egresos"
OWNER_UID = "NVapfgY8pshXwYbMq7Wz28ry3pC3"
ADMIN_ENDPOINTS = frozenset({"gmail_renovar", "gmail_debug", "gmail_reset_seen"})


def approved_member(claims, token):
    """Recibe claims previamente verificados; no almacena permisos en caché.

    Los registros antiguos sin activo/rol conservan acceso operativo. Un campo
    presente debe tener tipo y valor válidos. El dueño solo puede arrancar sin
    registro ante un 404 explícito; ni fallos de red ni un 403 conceden acceso.
    """
    uid = claims.get("sub", "")
    if not isinstance(uid, str) or not uid or len(uid) > 128:
        raise PermissionError("Usuario no autorizado.")
    if claims.get("iss") != f"https://securetoken.google.com/{PROJECT}":
        raise PermissionError("Emisor de sesión inválido.")
    url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)"
           f"/documents/usuarios/{quote(uid, safe='')}")
    response = requests.get(url, headers={"Authorization": "Bearer " + token},
                            timeout=(5, 10), allow_redirects=False)
    if response.status_code == 404 and uid == OWNER_UID:
        return {"uid": uid, "role": "admin"}
    if response.status_code in (403, 404):
        raise PermissionError("Tu cuenta no está dada de alta. Contacta al administrador.")
    if response.status_code != 200:
        raise RuntimeError("No se pudo comprobar la autorización.")
    document = response.json()
    if not isinstance(document, dict) or not isinstance(document.get("fields"), dict):
        raise PermissionError("Registro de usuario inválido. Contacta al administrador.")
    fields = document["fields"]
    active = fields.get("activo", {"booleanValue": True})
    if (not isinstance(active, dict) or set(active) != {"booleanValue"} or
            active["booleanValue"] is not True):
        raise PermissionError("Tu cuenta está desactivada o tiene un registro inválido.")
    role_field = fields.get("rol", {"stringValue": "operativo"})
    if (not isinstance(role_field, dict) or set(role_field) != {"stringValue"} or
            role_field["stringValue"] not in ("admin", "operativo")):
        raise PermissionError("Rol de usuario inválido. Contacta al administrador.")
    return {"uid": uid, "role": "admin" if uid == OWNER_UID else role_field["stringValue"]}
