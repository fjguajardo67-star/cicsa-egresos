"""
Genera un gmail_token.json nuevo para CICSA Control de Egresos.

Uso (desde tu máquina local, no en Railway):
  1. En Google Cloud Console > APIs y servicios > Credenciales, crea (o ya
     creaste) un ID de cliente OAuth tipo "Escritorio" y descarga su JSON.
  2. Guarda ese archivo en esta misma carpeta con el nombre gmail_credentials.json
  3. pip install google-auth-oauthlib google-api-python-client
  4. python generar_token_gmail.py
  5. Se abre el navegador — inicia sesión con la cuenta de Gmail que lee las
     facturas y acepta el acceso de solo lectura.
  6. El token queda en gmail_token.json y, si se puede, copiado al portapapeles.
     Pégalo en la variable GMAIL_TOKEN de Railway.

El contenido del token NO se imprime en pantalla: es una credencial viva (el
refresh_token no caduca) y la terminal deja rastro en el historial, en los logs
de la sesión y en cualquier captura. Ya pasó una vez que un token de este
proyecto terminó donde no debía.

gmail_credentials.json y gmail_token.json ya están en .gitignore — no los subas al repo.
"""
import os
import shutil
import subprocess
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
CREDS_FILE = Path(__file__).parent / "gmail_credentials.json"
TOKEN_FILE = Path(__file__).parent / "gmail_token.json"


def escribir_privado(ruta: Path, contenido: str) -> bool:
    """Escribe el archivo con permisos 0600 DESDE que se crea.

    El orden importa: escribir primero y hacer chmod después deja una ventana en
    la que el token es legible para cualquier usuario de la máquina. os.open con
    el modo la cierra. El chmod posterior cubre el caso de que el archivo ya
    existiera con permisos más abiertos, porque O_CREAT no los cambia.

    Devuelve True si el sistema aplica permisos POSIX (en Windows se ignoran).
    """
    fd = os.open(str(ruta), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(contenido)
    if os.name != "posix":
        return False
    os.chmod(str(ruta), 0o600)
    return True


def copiar_al_portapapeles(texto: str) -> str:
    """Deja el token en el portapapeles sin pasar por la pantalla.

    Devuelve el nombre de la herramienta usada, o "" si ninguna estaba
    disponible. Se prueba en orden de plataforma; que falle no es un error,
    solo significa que hay que abrir el archivo a mano.
    """
    candidatos = [
        ("pbcopy", ["pbcopy"]),                              # macOS
        ("clip", ["clip"]),                                  # Windows
        ("wl-copy", ["wl-copy"]),                            # Linux/Wayland
        ("xclip", ["xclip", "-selection", "clipboard"]),     # Linux/X11
    ]
    for nombre, cmd in candidatos:
        if shutil.which(cmd[0]) is None:
            continue
        try:
            subprocess.run(cmd, input=texto.encode("utf-8"), check=True)
            return nombre
        except Exception:
            continue
    return ""


def main():
    if not CREDS_FILE.exists():
        raise SystemExit(
            f"No encontré {CREDS_FILE.name} en esta carpeta.\n"
            "Descárgalo de Google Cloud Console > Credenciales > tu cliente OAuth "
            f"de tipo Escritorio, y guárdalo aquí como {CREDS_FILE.name}."
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
    creds = flow.run_local_server(port=0)

    token_json = creds.to_json()
    privado = escribir_privado(TOKEN_FILE, token_json)
    herramienta = copiar_al_portapapeles(token_json)

    print(f"\n✅ Token guardado en {TOKEN_FILE.name}")
    print(f"   Permisos: {'solo tu usuario (0600)' if privado else 'los de tu sistema (Windows no aplica 0600)'}")
    if herramienta:
        print(f"   Copiado al portapapeles con {herramienta}.")
        print("\nPégalo en Railway > Variables > GMAIL_TOKEN y redespliega.")
    else:
        print("   No encontré con qué copiarlo al portapapeles.")
        print(f"\nAbre {TOKEN_FILE.name} en un editor, copia TODO su contenido")
        print("y pégalo en Railway > Variables > GMAIL_TOKEN.")
    print("\nEl contenido no se imprime aquí a propósito: es una credencial viva.")
    print("Cuando termines, borra el archivo si no lo necesitas en esta máquina.")


if __name__ == "__main__":
    main()
