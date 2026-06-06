"""
CICSA — Módulo Gmail
Lee credenciales desde variables de entorno (Railway).
Guarda el token refrescado en Firebase para persistencia permanente.
"""

import base64, json, os, re, requests
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

# Firebase config para guardar token refrescado
FB_KEY  = "AIzaSyC5Scjnnabx4bJAdkUShlm53i38OXj8xgQ"
FB_BASE = "https://firestore.googleapis.com/v1/projects/cicsa-egresos/databases/(default)/documents"

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


def _load_token_data() -> dict | None:
    """Load token from env var, Firebase, or local file — in that order."""
    # 1. Try env var first
    token_env = os.environ.get("GMAIL_TOKEN", "").strip()
    if token_env:
        try:
            return json.loads(token_env)
        except Exception:
            pass

    # 2. Try Firebase
    try:
        r = requests.get(f"{FB_BASE}/config/gmail_token?key={FB_KEY}", timeout=5)
        if r.status_code == 200:
            data = r.json()
            val = data.get("fields", {}).get("json", {}).get("stringValue")
            if val:
                print("[OK] Gmail token loaded from Firebase")
                return json.loads(val)
    except Exception as e:
        print(f"[WARN] Could not load token from Firebase: {e}")

    # 3. Try local file
    if TOKEN_FILE.exists():
        try:
            return json.loads(TOKEN_FILE.read_text())
        except Exception:
            pass

    return None


def _save_token_to_firebase(creds: Credentials):
    """Save refreshed token to Firebase for persistence."""
    try:
        token_json = creds.to_json()
        requests.patch(
            f"{FB_BASE}/config/gmail_token?key={FB_KEY}",
            json={"fields": {
                "json": {"stringValue": token_json},
                "ts":   {"stringValue": datetime.now().isoformat()}
            }},
            timeout=5
        )
        print("[OK] Gmail token saved to Firebase")
    except Exception as e:
        print(f"[WARN] Could not save token to Firebase: {e}")

    # Also try local file
    try:
        TOKEN_FILE.write_text(creds.to_json())
    except Exception:
        pass


def get_gmail_service():
    """Get Gmail service — reads token from env/Firebase/file, refreshes automatically."""
    creds = None

    token_data = _load_token_data()
    if token_data:
        try:
            creds = Credentials.from_authorized_user_info(token_data, SCOPES)
            print("[OK] Gmail token loaded")
        except Exception as e:
            print(f"[WARN] Could not parse token: {e}")
            creds = None

    # Refresh if expired
    if creds and not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                print("[OK] Gmail token refreshed automatically")
                _save_token_to_firebase(creds)
            except Exception as e:
                print(f"[WARN] Token refresh failed: {e}")
                creds = None

    # If still no creds, try OAuth flow (local only)
    if not creds:
        creds_env = os.environ.get("GMAIL_CREDENTIALS", "").strip()
        if creds_env:
            raise RuntimeError(
                "Token de Gmail expirado. "
                "Ve a la app local y haz clic en 'Renovar autorización Gmail'."
            )
        elif CREDS_FILE.exists():
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
            _save_token_to_firebase(creds)
        else:
            raise FileNotFoundError(
                "No se encontraron credenciales de Gmail. "
                "Configura GMAIL_TOKEN en Railway."
            )

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
    except (FileNotFoundError, RuntimeError) as e:
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
