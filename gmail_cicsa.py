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
    # El CFDI en XML es la fuente EXACTA de la fecha, el folio y el total. Antes se ignoraba, y
    # con él se ignoraban facturas que el proveedor manda solo en XML.
    "text/xml", "application/xml",
    # Muchos proveedores mandan el par XML+PDF dentro de un zip.
    "application/zip", "application/x-zip-compressed", "multipart/x-zip",
}

# Un CFDI XML pesa unos pocos KB — el piso de 8 KB pensado para logos lo tiraría.
MIN_XML_BYTES = 200


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


# ── Registro de "vistos" — LEGADO, ya no se usa al leer el buzón ──────────
# Se conserva solo porque /gmail-reset-seen todavía borra el archivo en instalaciones viejas.
# fetch_invoice_attachments ya NO filtra con esto: era un archivo del servidor compartido por
# todo el equipo, así que el primero en revisar Gmail dejaba sin facturas a los demás.

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


def _sin_entidades(t):
    return (t.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
             .replace("&apos;", "'").replace("&amp;", "&"))


def _cfdi_attr(xml, tag_local, attr):
    m = re.search(r"<(?:[\w.-]+:)?" + tag_local + r"\b[^>]*>", xml, re.I)
    if not m:
        return ""
    a = re.search(r"\b" + attr + r'\s*=\s*"([^"]*)"', m.group(0), re.I)
    return _sin_entidades(a.group(1)) if a else ""


def leer_cfdi_xml(data: bytes):
    """Encabezado del CFDI: fecha, folio, emisor y total, tal como los timbró el SAT.

    Es el dato EXACTO. La lectura con IA de un PDF puede no encontrar la fecha, y cuando no la
    encuentra el formulario se queda con la de hoy: el gasto acaba en la semana equivocada y
    descuadra el presupuesto de dos semanas a la vez. Del XML la fecha nunca falta.
    """
    try:
        txt = data.decode("utf-8", errors="replace")
    except Exception:
        return None
    if "Comprobante" not in txt:
        return None
    fecha = _cfdi_attr(txt, "Comprobante", "Fecha")[:10]
    uuid  = _cfdi_attr(txt, "TimbreFiscalDigital", "UUID")
    if not fecha and not uuid:
        return None
    serie = _cfdi_attr(txt, "Comprobante", "Serie")
    folio = _cfdi_attr(txt, "Comprobante", "Folio")
    def num(v):
        try:    return float(v)
        except (TypeError, ValueError): return 0.0
    return {
        "fecha":     fecha,
        "total":     num(_cfdi_attr(txt, "Comprobante", "Total")),
        "subtotal":  num(_cfdi_attr(txt, "Comprobante", "SubTotal")),
        "tipo":      _cfdi_attr(txt, "Comprobante", "TipoDeComprobante").upper()[:1],
        "folio":     (serie + folio) or uuid,
        "uuid":      uuid,
        "proveedor": _cfdi_attr(txt, "Emisor", "Nombre") or _cfdi_attr(txt, "Emisor", "Rfc"),
        "rfc":       _cfdi_attr(txt, "Emisor", "Rfc"),
        "rfcReceptor": _cfdi_attr(txt, "Receptor", "Rfc"),
    }


def _abrir_zip(data: bytes):
    """Saca los PDF/XML/imágenes de dentro de un zip. Devuelve [(nombre, bytes)]."""
    import io as _io, zipfile
    fuera = []
    try:
        with zipfile.ZipFile(_io.BytesIO(data)) as z:
            for nom in z.namelist()[:40]:          # tope: un zip no debería traer más
                if nom.endswith("/"):
                    continue
                if not nom.lower().endswith((".pdf", ".xml", ".jpg", ".jpeg", ".png")):
                    continue
                try:
                    fuera.append((nom.split("/")[-1], z.read(nom)))
                except Exception:
                    continue
    except Exception:
        pass          # no era un zip válido — se ignora, no se rompe la lectura del buzón
    return fuera


# ── Función principal ─────────────────────────────────────────────────────

def fetch_invoice_attachments(days_back: int = 30, include_seen: bool = False) -> list:
    """Devuelve TODOS los adjuntos del rango. Quién ya capturó qué lo decide el cliente.

    Antes esto filtraba con gmail_seen.json, un archivo del SERVIDOR compartido por todos, y
    marcaba el correo como visto en cuanto lo DESCARGABA — no cuando alguien lo capturaba.
    Resultado: el primero que apretaba "Revisar Gmail" se consumía las facturas para el resto
    del equipo, y a los demás les llegaba la bandeja vacía. Como cada quien guarda su lista en
    el navegador, el que las bajó primero no notaba nada raro.

    La pregunta correcta no es "¿el servidor ya vio este correo?" sino "¿ya se capturó esta
    factura?", y eso vive en Firestore, compartido de verdad: el cliente cruza cada adjunto
    contra los gastos ya capturados (por msg_id y por huella del archivo) y contra el registro
    de revisados del equipo, y marca "ya capturada" / "ya descartada" sin quitársela a nadie.

    include_seen se sigue aceptando por compatibilidad con clientes viejos, pero ya no cambia
    nada: siempre se devuelve el rango completo.
    """
    INBOX_DIR.mkdir(exist_ok=True)
    results = []

    try:
        service = get_gmail_service()
    except (EnvironmentError, ValueError, RuntimeError) as e:
        return [{"error": str(e)}]
    except Exception as e:
        return [{"error": f"Error de autenticación Gmail: {e}"}]

    after_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y/%m/%d")

    # Se trae TODO adjunto del rango (sin filtrar por palabra en el ASUNTO). Muchos proveedores
    # no ponen "factura/cfdi" en el asunto — la palabra vive en el cuerpo o solo en el PDF — así
    # que el filtro por asunto se comía facturas recientes cuando el asunto no traía la palabra.
    # En un buzón de facturación casi todo es factura, y el usuario revisa cada adjunto de todos
    # modos. maxResults en el máximo de Gmail (500) para no cortar los más recientes.
    try:
        messages = service.users().messages().list(
            userId="me", q=f"has:attachment after:{after_date}", maxResults=500
        ).execute().get("messages", [])
    except Exception as e:
        return [{"error": f"Error consultando Gmail: {e}"}]

    for msg_ref in messages:
        msg_id = msg_ref["id"]

        try:
            msg     = service.users().messages().get(userId="me", id=msg_id, format="full").execute()
            headers = {h["name"].lower(): h["value"] for h in msg["payload"].get("headers", [])}
            subject = headers.get("subject", "")
            sender  = headers.get("from", "")
            date    = headers.get("date", "")

            if not is_whitelisted_sender(sender):
                continue

            payload = msg["payload"]
            parts   = extract_parts(payload.get("parts", [payload]))

            # 1) Reunir los adjuntos utilizables, abriendo los zips (XML+PDF suelen venir dentro).
            adjuntos = []          # [(nombre, bytes)]
            for idx, part in enumerate(parts):
                mime          = part.get("mimeType", "")
                filename_orig = part.get("filename", "")
                low           = filename_orig.lower()

                es_zip = low.endswith(".zip") or mime in (
                    "application/zip", "application/x-zip-compressed", "multipart/x-zip")
                es_ok  = mime in ALLOWED_MIME or low.endswith(
                    (".pdf", ".jpg", ".jpeg", ".png", ".xml"))
                if not (es_zip or es_ok):
                    continue

                # Logos/íconos incrustados en la firma del correo — no son facturas.
                if is_inline_part(part, filename_orig):
                    continue

                data = get_attachment_data(service, msg_id, part)
                if not data:
                    continue

                if es_zip:
                    adjuntos.extend(_abrir_zip(data))
                else:
                    adjuntos.append((filename_orig or f"adjunto_{idx}", data))

            # 2) Si el correo trae el CFDI en XML, de ahí sale la fecha exacta del comprobante.
            #    Se le pega a TODOS los adjuntos del mismo correo: el PDF y el XML son la misma
            #    factura, así que el PDF hereda la fecha buena en vez de depender de la IA.
            cfdi_meta = None
            for nom, data in adjuntos:
                if nom.lower().endswith(".xml") or b"Comprobante" in data[:4000]:
                    cfdi_meta = leer_cfdi_xml(data)
                    if cfdi_meta:
                        break

            # 3) Emitir. Si hay PDF o imagen, se manda eso (es lo que la persona sabe leer) y el
            #    XML solo aporta sus datos. El XML se manda como adjunto propio únicamente cuando
            #    el correo no trae nada visual — antes esas facturas no llegaban a la bandeja.
            visuales = [(n, d) for n, d in adjuntos
                        if n.lower().endswith((".pdf", ".jpg", ".jpeg", ".png"))]
            elegidos = visuales or [(n, d) for n, d in adjuntos if n.lower().endswith(".xml")]

            for idx, (nombre, data) in enumerate(elegidos):
                low = nombre.lower()
                es_xml = low.endswith(".xml")
                if len(data) < (MIN_XML_BYTES if es_xml else MIN_ATTACHMENT_BYTES):
                    continue

                safe_name = safe_filename(nombre, msg_id, idx)
                out_path  = INBOX_DIR / safe_name
                try:
                    out_path.write_bytes(data)
                except Exception:
                    pass  # filesystem read-only — se usa data_b64 igualmente

                b64 = base64.b64encode(data).decode()
                ext = Path(safe_name).suffix.lower()
                mime_out = ("application/pdf" if ext == ".pdf"
                            else "application/xml" if es_xml
                            else f"image/{ext.lstrip('.')}")

                results.append({
                    "filename":  safe_name,
                    "path":      str(out_path),
                    "sender":    sender,
                    "subject":   subject,
                    "date":      date,
                    "mime_type": mime_out,
                    "data_b64":  b64,
                    "msg_id":    msg_id,
                    "cfdi":      cfdi_meta,     # None si el correo no traía XML
                })

        except Exception as e:
            print(f"  ⚠ Error procesando mensaje {msg_id}: {e}")
            continue

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
