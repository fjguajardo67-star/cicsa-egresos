"""
CICSA — Control de Egresos + Lector de Nómina No Fiscal
Servidor local v3.0
"""
import anthropic, base64, json, os, sys, threading, webbrowser, signal, shutil
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS


try:
    from gmail_cicsa import fetch_invoice_attachments
    GMAIL_AVAILABLE = True
except ImportError:
    GMAIL_AVAILABLE = False
    def fetch_invoice_attachments(**k): return [{'error':'gmail_cicsa.py no encontrado'}]

try:
    from sheets_cicsa import (push_gasto, pull_gastos, update_aprobacion,
        delete_gasto, get_sheet_url, get_status as sheets_status,
        get_or_create_sheet, save_config, load_config)
    SHEETS_AVAILABLE = True
except ImportError:
    SHEETS_AVAILABLE = False

PORT     = 7432
BASE_DIR   = Path(__file__).parent
STATE_FILE = BASE_DIR / "cicsa_data.json"
BACKUP_FILE= BASE_DIR / "cicsa_data_backup.json"
IS_RAILWAY = os.environ.get("RAILWAY_ENVIRONMENT") is not None
app        = Flask(__name__)
# Límite de tamaño de request: los payloads legítimos son PDFs/imágenes en base64 (unos
# cuantos MB). Sin límite, cualquiera podía postear gigabytes y llenar el disco.
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024

# ── Autenticación: ID token de Firebase ──────────────────────────────────────
# En Railway la URL es pública: sin esto, cualquiera podía usar los endpoints de IA
# (quemando tokens de Anthropic de la cuenta) y bajar las facturas de Gmail. El frontend
# manda "Authorization: Bearer <idToken>" (usuario logueado en Firebase) y aquí se verifica
# la firma contra los certificados públicos de Google — no requiere service account; usa
# google-auth, que ya es dependencia del módulo de Gmail. En uso local no aplica.
from functools import wraps
FIREBASE_PROJECT_ID = "cicsa-egresos"
_google_verifier_request = None

def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not IS_RAILWAY:
            return fn(*args, **kwargs)
        authz = request.headers.get("Authorization", "")
        if not authz.startswith("Bearer "):
            return jsonify({"error": "Sesión requerida — inicia sesión y vuelve a intentar."}), 401
        try:
            global _google_verifier_request
            import google.auth.transport.requests as _gareq
            from google.oauth2 import id_token as _gid
            if _google_verifier_request is None:
                _google_verifier_request = _gareq.Request()
            claims = _gid.verify_firebase_token(
                authz[len("Bearer "):], _google_verifier_request,
                audience=FIREBASE_PROJECT_ID, clock_skew_in_seconds=10)
            if not claims:
                raise ValueError("token inválido")
        except Exception:
            return jsonify({"error": "Sesión inválida o expirada — vuelve a iniciar sesión."}), 401
        return fn(*args, **kwargs)
    return wrapper

def hacer_backup():
    """Create a backup of cicsa_data.json before overwriting."""
    if STATE_FILE.exists():
        try:
            shutil.copy2(str(STATE_FILE), str(BACKUP_FILE))
        except Exception:
            pass

def shutdown_handler(signum, frame):
    """Save state backup on Ctrl+C before exiting."""
    print("\n\n  [SAVE] Guardando datos antes de cerrar…")
    hacer_backup()
    print("  [OK] Datos guardados en cicsa_data.json")
    print("  Cerrando servidor CICSA. ¡Hasta luego!\n")
    sys.exit(0)

# Register graceful shutdown
signal.signal(signal.SIGINT,  shutdown_handler)
signal.signal(signal.SIGTERM, shutdown_handler)
CORS(app, origins=["https://fjguajardo67-star.github.io", "https://cicsa-egresos.cicsacomedores.com.mx", "http://cicsa-egresos.cicsacomedores.com.mx", "http://localhost:7432", "http://127.0.0.1:7432"])

CATEGORIAS = [
    "Cárnicos", "Lácteos / Cremería", "Frutas y Verduras", "Tortilla",
    "Abarrotes / Secos", "Refrescos / Pepsi", "Hielo", "Gas",
    "Limpieza / Plásticos", "Mantenimiento y Equipo",
    "Transporte / Combustible", "Servicios (Basura, Agua, Luz)",
    "Nómina / Personal", "Gastos Generales", "Otro"
]
CATS_STR = ", ".join(CATEGORIAS)

def get_client():
    key = os.environ.get("ANTHROPIC_API_KEY","").strip()
    if not key:
        raise ValueError("API key no configurada. Revisa CICSA_APIKEY.txt")
    return anthropic.Anthropic(api_key=key)


# PDF handled natively in call_claude — no conversion needed

def call_claude(client, b64, mime, prompt, max_tokens=2000):
    """Send image or PDF to Claude. PDFs are sent as documents, images as images."""
    # Normalize mime type
    mime = mime or "image/jpeg"
    if mime == "application/octet-stream":
        # Try to detect PDF by base64 header
        try:
            header = base64.b64decode(b64[:20]).decode("latin-1")
            mime = "application/pdf" if header.startswith("%PDF") else "image/jpeg"
        except Exception:
            mime = "image/jpeg"

    if mime == "application/pdf":
        # Send PDF natively using Anthropic document type
        content_block = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64}
        }
    else:
        # Ensure valid image mime type
        if mime not in ("image/jpeg","image/png","image/gif","image/webp"):
            mime = "image/jpeg"
        content_block = {
            "type": "image",
            "source": {"type": "base64", "media_type": mime, "data": b64}
        }

    resp = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=max_tokens,
        messages=[{"role":"user","content":[
            content_block,
            {"type":"text","text":prompt}
        ]}]
    )
    raw = resp.content[0].text.strip().replace("```json","").replace("```","").strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Claude pudo haber añadido texto antes/después del JSON.
        # Extraer el primer objeto JSON balanceado de la respuesta.
        import re
        start = raw.find("{")
        if start != -1:
            depth = 0
            for i in range(start, len(raw)):
                if raw[i] == "{":
                    depth += 1
                elif raw[i] == "}":
                    depth -= 1
                    if depth == 0:
                        candidate = raw[start:i+1]
                        return json.loads(candidate)
        # Si no se pudo extraer, relanzar para que el endpoint responda 422
        raise

# ── Serve HTML files ───────────────────────────────────────────────────────────
@app.route("/")
def index():
    # Serve Control de Egresos by default if present, else Lector Nomina
    for fname in ["index.html","CICSA_Control_Egresos.html","CICSA Control Egresos.html","CICSA_Lector_Nomina.html"]:
        if (BASE_DIR/fname).exists():
            return send_from_directory(str(BASE_DIR), fname)
    return "No se encontró el archivo HTML", 404

# Solo assets del frontend. Antes servía CUALQUIER archivo del directorio — incluidos
# cicsa_data.json (todo el estado financiero), gmail_seen.json y el propio código fuente —
# a quien conociera la URL pública de Railway.
ALLOWED_STATIC_EXT = {".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".ico", ".svg", ".webp"}

@app.route("/<path:filename>")
def static_files(filename):
    if Path(filename).suffix.lower() not in ALLOWED_STATIC_EXT:
        return "No encontrado", 404
    return send_from_directory(str(BASE_DIR), filename)

# ── /leer-nomina  (nómina no fiscal) ──────────────────────────────────────────
@app.route("/leer-nomina", methods=["POST"])
@require_auth
def leer_nomina():
    try:
        d = request.get_json()
        client = get_client()
        data = call_claude(client, d["image_base64"], d.get("mime_type","image/jpeg"),
            '''Analiza esta imagen de nómina.
Extrae SOLO los empleados con monto en "No fiscal" mayor a cero.
Devuelve ÚNICAMENTE JSON válido, sin texto adicional:
{"empresa":"...","periodo":"...","empleados":[{"nombre":"...","no_fiscal":0.00}]}''')
        return jsonify(data)
    except (json.JSONDecodeError, KeyError):
        return jsonify({"error":"No pude interpretar la imagen. Intenta con una imagen más clara."}), 422
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── /leer-gasto  (gasto simple — un solo tipo) ────────────────────────────────
@app.route("/leer-gasto", methods=["POST"])
@require_auth
def leer_gasto():
    try:
        d = request.get_json()
        client = get_client()
        data = call_claude(client, d["image_base64"], d.get("mime_type","image/jpeg"),
            f'''Analiza este documento (factura, recibo o ticket).
Extrae los datos y devuelve ÚNICAMENTE JSON válido, sin texto adicional:
{{
  "proveedor": "nombre del proveedor/emisor",
  "fecha": "YYYY-MM-DD",
  "factura": "número de factura, folio o ticket",
  "importe": 1234.56,
  "mixto": false,
  "categoria": "categoría de esta lista: {CATS_STR}"
}}
Si el documento tiene productos de VARIAS categorías distintas, pon "mixto": true
y en "categoria" pon la categoría principal (la de mayor importe).''',
            max_tokens=600)
        return jsonify(data)
    except (json.JSONDecodeError, KeyError):
        return jsonify({"error":"No pude leer el documento. Captura manualmente."}), 422
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── /analizar-division  (desglose por categoría de doc mixto) ─────────────────
@app.route("/analizar-division", methods=["POST"])
@require_auth
def analizar_division():
    try:
        d = request.get_json()
        client = get_client()
        data = call_claude(client, d["image_base64"], d.get("mime_type","image/jpeg"),
            f'''Analiza este documento (factura, recibo o ticket) con productos de VARIAS categorías.
Agrupa todos los productos por categoría y suma los importes de cada grupo.
Devuelve ÚNICAMENTE JSON válido, sin texto adicional:
{{
  "proveedor": "nombre del proveedor/emisor",
  "fecha": "YYYY-MM-DD",
  "factura": "número de factura o folio",
  "total": 1234.56,
  "partidas": [
    {{
      "categoria": "nombre exacto de esta lista: {CATS_STR}",
      "descripcion": "descripción breve de los productos",
      "importe": 456.78
    }}
  ]
}}
IMPORTANTE:
- La suma de todos los importes de partidas debe ser igual al total del documento.
- Si un producto no encaja en ninguna categoría usa "Otro" y descríbelo.
- Agrupa todos los productos de limpieza, desengrasantes, cloro en "Limpieza / Plásticos".
- Agrupa carnes, aves, embutidos en "Cárnicos".
- Agrupa lácteos, quesos, leche en "Lácteos / Cremería".
- Agrupa frutas y verduras frescas en "Frutas y Verduras".
- Agrupa refrescos, jugos, aguas en "Refrescos / Pepsi".
- Todo lo demás (salsas, condimentos, abarrotes secos, cereales) en "Abarrotes / Secos".''',
            max_tokens=2000)
        return jsonify(data)
    except (json.JSONDecodeError, KeyError):
        return jsonify({"error":"No pude analizar la división. Captura manualmente."}), 422
    except Exception as e:
        return jsonify({"error": str(e)}), 500




# ── /gmail-reset-seen ─────────────────────────────────────────────────────────
@app.route("/gmail-reset-seen", methods=["POST"])
@require_auth
def gmail_reset_seen():
    try:
        from pathlib import Path
        seen_file = Path(__file__).parent / "gmail_seen.json"
        if seen_file.exists():
            seen_file.unlink()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── /gmail-renovar  (force re-authorization) ─────────────────────────────────
@app.route("/gmail-renovar", methods=["POST"])
@require_auth
def gmail_renovar():
    try:
        from gmail_cicsa import revoke_and_reauthorize
        revoke_and_reauthorize()
        return jsonify({"ok": True, "msg": "Token renovado. Gmail listo."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── /gmail-fetch ──────────────────────────────────────────────────────────────
@app.route("/gmail-fetch", methods=["POST"])
@require_auth
def gmail_fetch():
    try:
        d     = request.get_json() or {}
        days  = int(d.get("days_back", 30))
        inc   = bool(d.get("include_seen", False))
        items = fetch_invoice_attachments(days_back=days, include_seen=inc)
        if items and "error" in items[0]:
            return jsonify({"error": items[0]["error"]}), 400
        return jsonify({"count": len(items), "items": items})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/gmail-status", methods=["GET"])
def gmail_status():
    from pathlib import Path
    # En Railway no hay archivos locales — Gmail se autoriza vía la variable de entorno
    # GMAIL_TOKEN. Los archivos solo aplican para uso local/desarrollo.
    token_env_ok = bool(os.environ.get("GMAIL_TOKEN", "").strip())
    creds_ok = token_env_ok or (Path(__file__).parent / "gmail_credentials.json").exists()
    token_ok = token_env_ok or (Path(__file__).parent / "gmail_token.json").exists()
    return jsonify({"credentials": creds_ok, "authorized": token_ok, "available": GMAIL_AVAILABLE})


# ── /sheets-status ────────────────────────────────────────────────────────────
@app.route("/sheets-status", methods=["GET"])
def sheets_status_route():
    if not SHEETS_AVAILABLE:
        return jsonify({"available": False, "error": "sheets_cicsa.py no encontrado"})
    try:
        st = sheets_status()
        st["available"] = True
        return jsonify(st)
    except Exception as e:
        return jsonify({"available": True, "configured": False, "error": str(e)})

# ── /sheets-config ────────────────────────────────────────────────────────────
@app.route("/sheets-config", methods=["POST"])
@require_auth
def sheets_config():
    if not SHEETS_AVAILABLE:
        return jsonify({"error": "sheets_cicsa.py no encontrado"}), 400
    try:
        d       = request.get_json()
        cfg     = load_config()
        usuario = d.get("usuario","").strip()
        sheet_id= d.get("sheet_id","").strip()
        if usuario: cfg["usuario"]  = usuario
        if sheet_id:cfg["sheet_id"] = sheet_id
        save_config(cfg)
        # Try to connect
        sh = get_or_create_sheet()
        return jsonify({"ok": True, "sheet_url": get_sheet_url(),
                        "sheet_id": sh.id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── /sheets-push ──────────────────────────────────────────────────────────────
@app.route("/sheets-push", methods=["POST"])
@require_auth
def sheets_push():
    if not SHEETS_AVAILABLE:
        return jsonify({"error": "No disponible"}), 400
    try:
        d      = request.get_json()
        gastos = d.get("gastos", [])
        semana = d.get("semana_label", "")
        ok, fail = 0, 0
        for g in gastos:
            if push_gasto(g, semana): ok += 1
            else: fail += 1
        return jsonify({"ok": ok, "failed": fail, "sheet_url": get_sheet_url()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── /sheets-pull ──────────────────────────────────────────────────────────────
@app.route("/sheets-pull", methods=["GET"])
@require_auth
def sheets_pull():
    if not SHEETS_AVAILABLE:
        return jsonify({"error": "No disponible"}), 400
    try:
        gastos = pull_gastos()
        return jsonify({"gastos": gastos, "count": len(gastos),
                        "sheet_url": get_sheet_url()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── /sheets-aprobar ───────────────────────────────────────────────────────────
@app.route("/sheets-aprobar", methods=["POST"])
@require_auth
def sheets_aprobar():
    if not SHEETS_AVAILABLE:
        return jsonify({"error": "No disponible"}), 400
    try:
        d          = request.get_json()
        gasto_id   = d.get("id","")
        estado     = d.get("estado","aprobado")   # aprobado / rechazado
        usuario    = d.get("usuario","")
        ok = update_aprobacion(gasto_id, estado, usuario)
        return jsonify({"ok": ok})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── /sheets-delete ────────────────────────────────────────────────────────────
@app.route("/sheets-delete", methods=["POST"])
@require_auth
def sheets_delete():
    if not SHEETS_AVAILABLE:
        return jsonify({"error": "No disponible"}), 400
    try:
        gasto_id = request.get_json().get("id","")
        ok = delete_gasto(gasto_id)
        return jsonify({"ok": ok})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── /save-state  (persist state to local file) ────────────────────────────────
# save/load-state existen para el uso LOCAL (respaldo en cicsa_data.json). En Railway el
# disco es efímero (se pierde en cada redeploy) y estos endpoints no tienen autenticación:
# cualquiera con la URL pública podía DESCARGAR todo el estado financiero (/load-state) o
# SOBREESCRIBIRLO (/save-state) y envenenar el arranque de la app, que prefería el estado
# del servidor si traía más gastos. En producción la fuente durable es Firestore (con auth),
# así que aquí se apagan; el frontend ya tolera su ausencia (timeout + fallback a Firestore).
@app.route("/save-state", methods=["POST"])
def save_state():
    if IS_RAILWAY:
        return jsonify({"error": "deshabilitado en producción — el estado vive en Firestore"}), 404
    try:
        data = request.get_json()
        # Write to temp file first, then rename — atomic write
        tmp_file = BASE_DIR / "cicsa_data.tmp"
        tmp_file.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        # Backup existing before overwriting
        hacer_backup()
        tmp_file.replace(STATE_FILE)
        return jsonify({"ok": True, "file": str(STATE_FILE)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── /load-state  (restore state from local file) ──────────────────────────────
@app.route("/load-state", methods=["GET"])
def load_state():
    if IS_RAILWAY:
        return jsonify({"error": "deshabilitado en producción — el estado vive en Firestore"}), 404
    try:
        # Try main file first
        for f in [STATE_FILE, BACKUP_FILE]:
            if f.exists():
                try:
                    data = json.loads(f.read_text())
                    src_name = "principal" if f == STATE_FILE else "respaldo"
                    return jsonify({"ok": True, "state": data, "source": src_name})
                except Exception:
                    continue
        return jsonify({"ok": False, "state": None})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── /sat-leer-cfdi  (read SAT CFDI PDF with AI — paginated) ──────────────────
@app.route("/sat-leer-cfdi", methods=["POST"])
@require_auth
def sat_leer_cfdi():
    """
    Lee PDF del SAT procesando en 2 mitades para documentos grandes (70-100 CFDIs).
    Primera llamada: extrae CFDIs 1-N/2. Segunda: extrae N/2+1-N. Combina ambos.
    """
    try:
        d         = request.get_json()
        b64       = d.get("pdf_b64", "")
        fecha_ini = d.get("fecha_ini", "")
        fecha_fin = d.get("fecha_fin", "")
        client    = get_client()

        filtro = f"Solo CFDIs con fecha entre {fecha_ini} y {fecha_fin}." if fecha_ini and fecha_fin else ""

        def leer_chunk(instruccion_extra):
            prompt = f"""Eres un extractor de datos SAT Mexico.
PDF: Consulta CFDI oficial. {filtro}
{instruccion_extra}

Por cada CFDI extrae: Folio Fiscal (UUID), RFC Emisor, Nombre Emisor, Total (numero), Fecha (YYYY-MM-DD).

IMPORTANTE: Devuelve SOLO JSON valido. Sin texto adicional. Cierra TODOS los corchetes.

{{"cfdis":[{{"folio":"","rfc":"","proveedor":"","fecha":"YYYY-MM-DD","total":0.00}}]}}"""

            resp = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=6000,
                messages=[{"role":"user","content":[
                    {"type":"document","source":{"type":"base64","media_type":"application/pdf","data":b64}},
                    {"type":"text","text":prompt}
                ]}]
            )
            raw = resp.content[0].text.strip().replace("```json","").replace("```","").strip()
            return raw

        def parse_or_repair(raw):
            """Parse JSON, repair if truncated, fallback to regex."""
            import re
            try:
                return json.loads(raw).get("cfdis", [])
            except Exception:
                pass
            # Repair: cut after last complete CFDI object
            try:
                last = max(raw.rfind("},"), raw.rfind("}]"))
                if last > 0:
                    repaired = raw[:last+1] + "]}"
                    return json.loads(repaired).get("cfdis", [])
            except Exception:
                pass
            # Regex fallback
            matches = re.findall(
                r'"folio"\s*:\s*"([^"]+)"[^}]*"rfc"\s*:\s*"([^"]+)"[^}]*"proveedor"\s*:\s*"([^"]+)"[^}]*"fecha"\s*:\s*"([^"]+)"[^}]*"total"\s*:\s*([\d.]+)',
                raw, re.DOTALL)
            return [{"folio":f,"rfc":r,"proveedor":p,"fecha":fe,"total":float(t)}
                    for f,r,p,fe,t in matches]

        # ── Primera mitad ─────────────────────────────────────────────
        raw1 = leer_chunk(
            "Extrae los PRIMEROS 40 CFDIs del documento (paginas 1 a 6 aproximadamente)."
        )
        cfdis1 = parse_or_repair(raw1)

        # ── Segunda mitad ─────────────────────────────────────────────
        raw2 = leer_chunk(
            "Extrae los ULTIMOS CFDIs del documento (paginas 7 en adelante). "
            "Omite los que ya aparecen en las primeras 6 paginas."
        )
        cfdis2 = parse_or_repair(raw2)

        # ── Combinar y deduplicar por folio ───────────────────────────
        vistos  = set()
        todos   = []
        for c in cfdis1 + cfdis2:
            folio = c.get("folio","").strip()
            if folio and folio not in vistos:
                vistos.add(folio)
                todos.append(c)

        if not todos:
            return jsonify({"error":
                "No se pudieron extraer CFDIs. Verifica que el PDF sea "
                "la Consulta CFDI del portal del SAT."}), 422

        return jsonify({"cfdis": todos, "total_encontrados": len(todos)})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── /leer-productos  (extrae productos individuales con precio por kg para Menú) ─
@app.route("/leer-productos", methods=["POST"])
@require_auth
def leer_productos():
    """
    Lee una factura y extrae productos individuales con precio unitario.
    Usado por el modal 🍽️ Exportar a Menú para pre-llenar ingredientes.
    """
    try:
        d      = request.get_json()
        client = get_client()
        data   = call_claude(
            client,
            d["image_base64"],
            d.get("mime_type", "image/jpeg"),
            '''Analiza esta factura o recibo de proveedor de alimentos.
Extrae CADA producto individual con su precio unitario por kg, lt o pieza.
Si el documento no muestra precio unitario, calcula: precio_unitario = importe / cantidad.

Devuelve ÚNICAMENTE JSON válido, sin texto adicional:
{
  "proveedor": "nombre del proveedor",
  "fecha": "YYYY-MM-DD",
  "factura": "número de factura o folio",
  "total": 1234.56,
  "productos": [
    {
      "nombre": "nombre del producto (ej: Pollo pechuga, Res molida, Papa blanca)",
      "cantidad": 10.5,
      "unidad": "kg",
      "precio_unitario": 85.00,
      "importe": 892.50
    }
  ]
}

REGLAS:
- unidad debe ser: kg, lt, pz, cja, paq
- nombre debe ser el producto específico, no la marca ni el proveedor
- Si no puedes extraer productos individuales (ticket simple sin detalle), devuelve "productos": []
- precio_unitario es el precio por unidad (kg, lt, pz) — NO el importe total
- Es MUY IMPORTANTE que incluyas TODOS los productos del documento, sin omitir ninguno,
  incluso si son muchos (facturas grandes pueden tener 20-30+ productos distintos).
''',
            max_tokens=8000
        )
        return jsonify(data)
    except (json.JSONDecodeError, KeyError):
        return jsonify({"error": "No pude extraer productos individuales.", "productos": []}), 422
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/precios-ingredientes", methods=["GET"])
@require_auth
def precios_ingredientes():
    """
    Extrae precios de proveedores desde los gastos capturados.
    La App de Menú consume este endpoint para actualizar sus costos.
    """
    try:
        # Load state
        precios = {}
        if STATE_FILE.exists():
            state = json.loads(STATE_FILE.read_text())
            # Walk all weeks and gastos
            for week in state.get("weeks", []):
                for g in week.get("gastos", []):
                    proveedor = (g.get("proveedor") or "").strip()
                    importe   = float(g.get("importe") or 0)
                    fecha     = g.get("fecha") or ""
                    categoria = g.get("categoria") or "Gastos Generales"
                    notas     = (g.get("notas") or "").strip()
                    if not proveedor or importe <= 0:
                        continue
                    # Use proveedor as key; keep the most recent entry
                    if proveedor not in precios or fecha > precios[proveedor]["fecha"]:
                        precios[proveedor] = {
                            "proveedor": proveedor,
                            "precio":    importe,
                            "categoria": categoria,
                            "fecha":     fecha,
                            "notas":     notas
                        }

        result = sorted(precios.values(), key=lambda x: x["proveedor"])
        return jsonify({
            "ok":     True,
            "count":  len(result),
            "precios": result,
            "exportado": __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M")
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── /precios-ingredientes  CORS preflight ─────────────────────────────────────
@app.route("/precios-ingredientes", methods=["OPTIONS"])
def precios_ingredientes_options():
    return "", 200

# ── /status ────────────────────────────────────────────────────────────────────
@app.route("/status")
def status():
    return jsonify({"ok":True, "api_key_set":bool(os.environ.get("ANTHROPIC_API_KEY")), "version":"3.0"})

# ── Main ───────────────────────────────────────────────────────────────────────
def load_api_key():
    key_file = BASE_DIR / "CICSA_APIKEY.txt"
    if key_file.exists():
        for line in key_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                os.environ["ANTHROPIC_API_KEY"] = line
                return True
    return bool(os.environ.get("ANTHROPIC_API_KEY"))

if __name__ == "__main__":
    print("="*55)
    print("  CICSA — Control de Egresos / Nómina  v3.0")
    print("="*55)
    if not load_api_key():
        print("\n[WARN]  API KEY NO ENCONTRADA")
        print("   Crea CICSA_APIKEY.txt con tu clave de Anthropic.")
        input("Presiona Enter para salir..."); sys.exit(1)
    print(f"\n[OK] API key cargada")
    _railway_port = int(os.environ.get("PORT", PORT))
    _is_railway = IS_RAILWAY
    if _is_railway:
        print(f"[RAILWAY] Servidor corriendo en puerto {_railway_port}")
        app.run(host="0.0.0.0", port=_railway_port, debug=False, threaded=True)
    else:
        print(f"[WEB] Abriendo navegador en http://localhost:{PORT}")
        print(f"\n   No cierres esta ventana. Para salir: Ctrl+C\n")
        threading.Thread(target=lambda: (__import__('time').sleep(1.2),
            webbrowser.open(f"http://localhost:{PORT}")), daemon=True).start()
        app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)
