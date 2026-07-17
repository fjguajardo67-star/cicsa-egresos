"""
CICSA — Módulo Gmail
Revisa el inbox de Gmail y extrae adjuntos de facturas automáticamente.
Credenciales cargadas desde variables de entorno (sin escribir archivos).
"""

import base64, json, os, re
from pathlib import Path
from datetime import datetime, timedelta

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

BASE_DIR  = Path(__file__).parent
INBOX_DIR = BASE_DIR / "facturas_inbox"
SEEN_FILE = BASE_DIR / "gmail_seen.json"

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

SUBJECT_KEYWORDS = [
    "factura", "invoice", "comprobante", "cfdi", "recibo",
    "ticket", "nota", "cargo", "cobro", "pago"
]
SENDER_WHITELIST = []

ALLOWED_MIME = {
    "application/pdf",
    "image/jpeg", "image/jpg", "image/png", "image/webp",
    "application/octet-stream",
}


# ── Credenciales en memoria (sin tocar el filesystem) ─────────────────────

def get_gmail_service():
    token_env = os.environ.get("GMAIL_TOKEN", "").strip()
    if not token_env:
        raise EnvironmentError(
            "Variable de entorno GMAIL_TOKEN no definida. "
            "Configúrala en Railway con el contenido de gmail_token.json."
        )

    try:
        token_data = json.loads(token_env)
    except json.JSONDecodeError as e:
        raise ValueError(f"GMAIL_TOKEN no es JSON válido: {e}")

    creds = Credentials.from_authorized_user_info(token_data, SCOPES)

    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                # No podemos persistir el token refreshed en Railway (read-only filesystem),
                # pero el refresh_token sigue siendo válido para la próxima ejecución.
                print("[Gmail] Token refrescado en memoria (actualiza GMAIL_TOKEN si expira).")
            except Exception as e:
                raise RuntimeError(
                    f"Fallo al refrescar el token de Gmail: {e}\n"
                    "Regenera el token localmente y actualiza la variable GMAIL_TOKEN en Railway."
                )
        else:
            raise RuntimeError(
                "El token de Gmail no es válido y no tiene refresh_token. "
                "Regenera el token localmente y actualiza GMAIL_TOKEN en Railway."
            )

    return build("gmail", "v1", credentials=creds)


def revoke_and_reauthorize():
    """Fuerza un refresh del access token de Gmail usando el refresh_token vigente.

    En Railway el filesystem es de solo lectura y no hay flujo interactivo de OAuth,
    así que "renovar autorización" significa descartar el access token en memoria y
    pedirle a Google uno nuevo con el refresh_token de GMAIL_TOKEN.
    """
    token_env = os.environ.get("GMAIL_TOKEN", "").strip()
    if not token_env:
        raise EnvironmentError(
            "Variable de entorno GMAIL_TOKEN no definida. "
            "Configúrala en Railway con el contenido de gmail_token.json."
        )

    try:
        token_data = json.loads(token_env)
    except json.JSONDecodeError as e:
        raise ValueError(f"GMAIL_TOKEN no es JSON válido: {e}")

    creds = Credentials.from_authorized_user_info(token_data, SCOPES)
    if not creds.refresh_token:
        raise RuntimeError(
            "El token de Gmail no tiene refresh_token. "
            "Regenera el token localmente y actualiza GMAIL_TOKEN en Railway."
        )

    creds.refresh(Request())
    return build("gmail", "v1", credentials=creds)


# ── Persistencia de mensajes ya procesados ────────────────────────────────

def load_seen() -> set:
    if SEEN_FILE.exists():
        try:
            return set(json.loads(SEEN_FILE.read_text()))
        except Exception:
            return set()
    return set()


def save_seen(seen: set):
    try:
        SEEN_FILE.write_text(json.dumps(list(seen)))
    except Exception:
        pass  # read-only filesystem en producción — no crítico


# ── Helpers ───────────────────────────────────────────────────────────────

def is_invoice_subject(subject: str) -> bool:
    s = (subject or "").lower()
    return any(kw in s for kw in SUBJECT_KEYWORDS)


def is_whitelisted_sender(sender: str) -> bool:
    if not SENDER_WHITELIST:
        return True
    return any(w.lower() in sender.lower() for w in SENDER_WHITELIST)


def safe_filename(original: str, msg_id: str, idx: int) -> str:
    name = re.sub(r"[^\w.\-]", "_", original or f"adjunto_{idx}")
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{ts}_{msg_id[:8]}_{name}"


def get_attachment_data(service, msg_id: str, part: dict):
    body = part.get("body", {})
    data = body.get("data")
    if data:
        return base64.urlsafe_b64decode(data)
    att_id = body.get("attachmentId")
    if att_id:
        att = service.users().messages().attachments().get(
            userId="me", messageId=msg_id, id=att_id
        ).execute()
        return base64.urlsafe_b64decode(att["data"])
    return None


def extract_parts(parts: list) -> list:
    result = []
    for p in parts:
        if p.get("parts"):
            result.extend(extract_parts(p["parts"]))
        else:
            result.append(p)
    return result


# Umbral mínimo de tamaño — los logos/íconos incrustados en firmas de correo casi siempre
# pesan unos cuantos KB; una factura real (foto o PDF escaneado) casi nunca pesa menos de esto.
MIN_ATTACHMENT_BYTES = 8 * 1024

# Nombre típico que Outlook Web le da a las imágenes incrustadas en la firma/cuerpo del
# correo (ej. "Outlook-542f5cee.png") — no son adjuntos reales, son logos repetidos en cada
# respuesta del hilo.
_INLINE_FILENAME_RE = re.compile(r"outlook-[0-9a-z]{6,}\.", re.IGNORECASE)


def is_inline_part(part: dict, filename: str) -> bool:
    """¿Esta parte es una imagen incrustada (firma/logo del cuerpo del correo) en vez de un
    adjunto real? Gmail marca esto con Content-Disposition: inline en los headers de la parte."""
    for h in part.get("headers", []):
        if h.get("name", "").lower() == "content-disposition":
            if "inline" in h.get("value", "").lower():
                return True
    return bool(_INLINE_FILENAME_RE.search(filename or ""))


# ── Función principal ─────────────────────────────────────────────────────

def fetch_invoice_attachments(days_back: int = 30, include_seen: bool = False) -> list:
    # include_seen=True ignora el registro de "vistos" y devuelve TODOS los adjuntos del rango
    # (para re-procesar facturas ya capturadas con la IA). El cliente las marca "ya capturada"
    # y ofrece "Leer igual". No depende de borrar gmail_seen.json, que es frágil en Railway
    # (filesystem efímero/solo-lectura).
    INBOX_DIR.mkdir(exist_ok=True)
    seen    = load_seen()
    results = []

    try:
        service = get_gmail_service()
    except (EnvironmentError, ValueError, RuntimeError) as e:
        return [{"error": str(e)}]
    except Exception as e:
        return [{"error": f"Error de autenticación Gmail: {e}"}]

    after_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y/%m/%d")
    kw_query   = " OR ".join(f'subject:{kw}' for kw in SUBJECT_KEYWORDS)
    query      = f"has:attachment ({kw_query}) after:{after_date}"

    try:
        resp     = service.users().messages().list(userId="me", q=query, maxResults=100).execute()
        messages = resp.get("messages", [])
    except Exception as e:
        return [{"error": f"Error consultando Gmail: {e}"}]

    for msg_ref in messages:
        msg_id = msg_ref["id"]
        if msg_id in seen and not include_seen:
            continue

        try:
            msg     = service.users().messages().get(userId="me", id=msg_id, format="full").execute()
            headers = {h["name"].lower(): h["value"] for h in msg["payload"].get("headers", [])}
            subject = headers.get("subject", "")
            sender  = headers.get("from", "")
            date    = headers.get("date", "")

            if not is_whitelisted_sender(sender):
                seen.add(msg_id)
                continue

            payload = msg["payload"]
            parts   = extract_parts(payload.get("parts", [payload]))

            for idx, part in enumerate(parts):
                mime          = part.get("mimeType", "")
                filename_orig = part.get("filename", "")

                if mime not in ALLOWED_MIME:
                    if not (filename_orig.lower().endswith(".pdf") or
                            filename_orig.lower().endswith((".jpg", ".jpeg", ".png"))):
                        continue

                # Logos/íconos incrustados en la firma del correo — no son facturas.
                if is_inline_part(part, filename_orig):
                    continue

                data = get_attachment_data(service, msg_id, part)
                if not data:
                    continue

                if len(data) < MIN_ATTACHMENT_BYTES:
                    continue

                safe_name = safe_filename(filename_orig, msg_id, idx)
                out_path  = INBOX_DIR / safe_name
                try:
                    out_path.write_bytes(data)
                except Exception:
                    pass  # filesystem read-only — se usa data_b64 igualmente

                b64     = base64.b64encode(data).decode()
                ext     = Path(safe_name).suffix.lower()
                mime_out = "application/pdf" if ext == ".pdf" else f"image/{ext.lstrip('.')}"

                results.append({
                    "filename":  safe_name,
                    "path":      str(out_path),
                    "sender":    sender,
                    "subject":   subject,
                    "date":      date,
                    "mime_type": mime_out,
                    "data_b64":  b64,
                    "msg_id":    msg_id,
                })

            seen.add(msg_id)

        except Exception as e:
            print(f"  ⚠ Error procesando mensaje {msg_id}: {e}")
            continue

    save_seen(seen)
    return [r for r in results if "error" not in r] or results


def gmail_diagnostics(days_back: int = 90) -> dict:
    """Diagnóstico: qué cuenta está conectada, cuántos correos matchea el query, y con qué
    fecha. Sirve para saber por qué un fetch devuelve 0 (cuenta equivocada / asunto sin
    palabra clave / ventana de fecha). No descarga adjuntos."""
    try:
        service = get_gmail_service()
    except Exception as e:
        return {"error": f"auth: {e}"}
    try:
        account = service.users().getProfile(userId="me").execute().get("emailAddress")
    except Exception as e:
        account = f"(profile err: {e})"

    after_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y/%m/%d")
    kw_query   = " OR ".join(f"subject:{kw}" for kw in SUBJECT_KEYWORDS)
    q_full     = f"has:attachment ({kw_query}) after:{after_date}"

    def _count(q):
        try:
            return len(service.users().messages().list(userId="me", q=q, maxResults=100).execute().get("messages", []))
        except Exception as e:
            return f"err: {e}"

    return {
        "account":              account,
        "server_now":           datetime.now().isoformat(),
        "after_date":           after_date,
        "query_completo":       q_full,
        "match_query_completo": _count(q_full),
        "match_solo_adjuntos":  _count(f"has:attachment after:{after_date}"),
        "match_solo_factura":   _count(f"subject:factura after:{after_date}"),
        "match_sin_fecha":      _count("has:attachment (" + kw_query + ")"),
    }
