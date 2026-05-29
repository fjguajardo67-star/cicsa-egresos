"""
CICSA — Módulo Gmail
Revisa el inbox de Gmail y extrae adjuntos de facturas automáticamente.
"""

import base64, json, os, re
from pathlib import Path
from datetime import datetime, timedelta

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

BASE_DIR   = Path(__file__).parent
TOKEN_FILE = BASE_DIR / "gmail_token.json"
CREDS_FILE = BASE_DIR / "gmail_credentials.json"
INBOX_DIR  = BASE_DIR / "facturas_inbox"
SEEN_FILE  = BASE_DIR / "gmail_seen.json"

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

# ── Write credentials from env vars if files don't exist (Railway) ─────────
def _write_credentials_from_env():
    token_env = os.environ.get("GMAIL_TOKEN", "").strip()
    creds_env = os.environ.get("GMAIL_CREDENTIALS", "").strip()
    if token_env and not TOKEN_FILE.exists():
        try:
            TOKEN_FILE.write_text(token_env)
            print("[OK] gmail_token.json written from env var")
        except Exception as e:
            print(f"[WARN] Could not write gmail_token.json: {e}")
    if creds_env and not CREDS_FILE.exists():
        try:
            CREDS_FILE.write_text(creds_env)
            print("[OK] gmail_credentials.json written from env var")
        except Exception as e:
            print(f"[WARN] Could not write gmail_credentials.json: {e}")

_write_credentials_from_env()

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

def get_gmail_service():
    creds = None
    if TOKEN_FILE.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
        except Exception:
            TOKEN_FILE.unlink(missing_ok=True)
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                TOKEN_FILE.write_text(creds.to_json())
            except Exception as e:
                print(f"  Token refresh failed ({e}) — re-authorizing…")
                TOKEN_FILE.unlink(missing_ok=True)
                creds = None

        if not creds:
            if not CREDS_FILE.exists():
                raise FileNotFoundError(
                    "No se encontró gmail_credentials.json. "
                    "Descárgalo de Google Cloud Console."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
            TOKEN_FILE.write_text(creds.to_json())

    return build("gmail", "v1", credentials=creds)

def revoke_and_reauthorize():
    TOKEN_FILE.unlink(missing_ok=True)
    return get_gmail_service()

def load_seen():
    if SEEN_FILE.exists():
        return set(json.loads(SEEN_FILE.read_text()))
    return set()

def save_seen(seen: set):
    try:
        SEEN_FILE.write_text(json.dumps(list(seen)))
    except Exception:
        pass

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

def fetch_invoice_attachments(days_back: int = 30) -> list:
    INBOX_DIR.mkdir(exist_ok=True)
    seen    = load_seen()
    results = []

    try:
        service = get_gmail_service()
    except FileNotFoundError as e:
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
        if msg_id in seen:
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
                mime = part.get("mimeType", "")
                filename_orig = part.get("filename", "")

                if mime not in ALLOWED_MIME:
                    if not (filename_orig.lower().endswith(".pdf") or
                            filename_orig.lower().endswith((".jpg",".jpeg",".png"))):
                        continue

                data = get_attachment_data(service, msg_id, part)
                if not data:
                    continue

                safe_name = safe_filename(filename_orig, msg_id, idx)
                out_path  = INBOX_DIR / safe_name
                try:
                    out_path.write_bytes(data)
                except Exception:
                    pass

                b64 = base64.b64encode(data).decode()
                ext = Path(safe_name).suffix.lower()
                mime_out = "application/pdf" if ext == ".pdf" else f"image/{ext.lstrip('.')}"

                results.append({
                    "filename":   safe_name,
                    "path":       str(out_path),
                    "sender":     sender,
                    "subject":    subject,
                    "date":       date,
                    "mime_type":  mime_out,
                    "data_b64":   b64,
                    "msg_id":     msg_id,
                })

            seen.add(msg_id)

        except Exception as e:
            print(f"  ⚠ Error procesando mensaje {msg_id}: {e}")
            continue

    save_seen(seen)
    return [r for r in results if "error" not in r] or results
