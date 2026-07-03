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
  6. Se crea gmail_token.json en esta carpeta y se imprime su contenido.
     Copia ese contenido completo a la variable GMAIL_TOKEN en Railway.

gmail_credentials.json y gmail_token.json ya están en .gitignore — no los subas al repo.
"""
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
CREDS_FILE = Path(__file__).parent / "gmail_credentials.json"
TOKEN_FILE = Path(__file__).parent / "gmail_token.json"


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
    TOKEN_FILE.write_text(token_json)

    print(f"\n✅ Token guardado en {TOKEN_FILE.name}\n")
    print("Copia este contenido completo a la variable GMAIL_TOKEN en Railway:\n")
    print(token_json)


if __name__ == "__main__":
    main()
