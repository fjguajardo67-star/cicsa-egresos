"""
CICSA — pruebas de los helpers puros de gmail_cicsa.py.

Los módulos de Google se stubean ANTES del import, así que estas pruebas corren
sin instalar google-api-python-client ni tocar la red.

Correr:  python3 tests/test_gmail_cicsa.py
"""
import sys
import types
import unittest
from pathlib import Path

# ── Stubs de los módulos de Google (no se usan en los helpers probados) ──────
for name in [
    "google", "google.auth", "google.auth.transport",
    "google.auth.transport.requests", "google.oauth2",
    "google.oauth2.credentials", "googleapiclient", "googleapiclient.discovery",
]:
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["google.auth.transport.requests"].Request = object
sys.modules["google.oauth2.credentials"].Credentials = object
sys.modules["googleapiclient.discovery"].build = lambda *a, **k: None

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import gmail_cicsa as gc  # noqa: E402


class TestSubjectFilter(unittest.TestCase):
    def test_asuntos_de_factura(self):
        self.assertTrue(gc.is_invoice_subject("Factura Electrónica NWM..."))
        self.assertTrue(gc.is_invoice_subject("Su RECIBO de pago"))
        self.assertTrue(gc.is_invoice_subject("comprobante CFDI adjunto"))

    def test_asuntos_irrelevantes(self):
        self.assertFalse(gc.is_invoice_subject("Reunión del viernes"))
        self.assertFalse(gc.is_invoice_subject(""))
        self.assertFalse(gc.is_invoice_subject(None))

    def test_whitelist_vacia_acepta_todo(self):
        self.assertEqual(gc.SENDER_WHITELIST, [])
        self.assertTrue(gc.is_whitelisted_sender("cualquiera@dominio.com"))


class TestInlineDetection(unittest.TestCase):
    def test_content_disposition_inline(self):
        part = {"headers": [{"name": "Content-Disposition", "value": "inline; filename=logo.png"}]}
        self.assertTrue(gc.is_inline_part(part, "logo.png"))

    def test_nombre_outlook_de_firma(self):
        self.assertTrue(gc.is_inline_part({"headers": []}, "Outlook-542f5cee.png"))

    def test_adjunto_real_no_es_inline(self):
        part = {"headers": [{"name": "Content-Disposition", "value": "attachment; filename=factura.pdf"}]}
        self.assertFalse(gc.is_inline_part(part, "factura.pdf"))

    def test_umbral_minimo_es_8kb(self):
        self.assertEqual(gc.MIN_ATTACHMENT_BYTES, 8 * 1024)


class TestSafeFilename(unittest.TestCase):
    def test_sanitiza_caracteres_raros(self):
        out = gc.safe_filename("fac tura/€$#.pdf", "MSGID12345678", 0)
        self.assertNotIn("/", out)
        self.assertNotIn(" ", out)
        self.assertIn("MSGID123", out)  # primeros 8 del msg_id
        self.assertTrue(out.endswith(".pdf"))

    def test_nombre_vacio_usa_fallback(self):
        out = gc.safe_filename("", "MSGID12345678", 3)
        self.assertIn("adjunto_3", out)


class TestExtractParts(unittest.TestCase):
    def test_aplana_partes_anidadas(self):
        parts = [
            {"mimeType": "multipart/mixed", "parts": [
                {"mimeType": "text/plain"},
                {"mimeType": "multipart/alternative", "parts": [{"mimeType": "application/pdf"}]},
            ]},
            {"mimeType": "image/png"},
        ]
        flat = gc.extract_parts(parts)
        self.assertEqual([p["mimeType"] for p in flat], ["text/plain", "application/pdf", "image/png"])


class TestIncludeSeen(unittest.TestCase):
    """include_seen ya no cambia el resultado: el registro de vistos vive en Firestore."""

    _PATCHED = ["get_gmail_service", "load_seen", "save_seen", "get_attachment_data",
                "is_whitelisted_sender", "is_inline_part"]

    # fetch_invoice_attachments guarda cada adjunto en disco, así que sin esto la prueba
    # dejaba archivos sueltos en facturas_inbox/ dentro del repo cada vez que se corría.
    # Están en .gitignore —nunca se habrían subido— pero una prueba que ensucia el árbol
    # de trabajo es una prueba que la gente deja de correr, y ésta llevaba meses en rojo
    # justamente porque nadie la corría.
    def setUp(self):
        import tempfile
        self._orig = {n: getattr(gc, n, None) for n in self._PATCHED}
        self._tmp = tempfile.TemporaryDirectory()
        self._inbox_real = gc.INBOX_DIR
        gc.INBOX_DIR = Path(self._tmp.name)

    def tearDown(self):
        for n, fn in self._orig.items():
            setattr(gc, n, fn)
        gc.INBOX_DIR = self._inbox_real
        self._tmp.cleanup()

    def _fake_service(self):
        part = {"mimeType": "application/pdf", "filename": "factura.pdf",
                "body": {"attachmentId": "A1"}}
        msg = {"payload": {"headers": [{"name": "Subject", "value": "Factura X"},
                                       {"name": "From", "value": "prov@dominio.com"}],
                           "parts": [part]}}
        class Msgs:
            def list(self, **k): return self
            def get(self, **k): return self
            def execute(self):  return {"messages": [{"id": "M1"}]} if not hasattr(self, "_g") else msg
        class Users:
            def messages(self):
                m = Msgs()
                return m
        class Svc:
            def users(self): return Users()
        # list() y get() comparten clase; distinguimos por el flag que pone get()
        real_msgs = Msgs()
        def users():
            u = Users()
            def messages():
                mm = Msgs()
                _orig_get = mm.get
                def get(**k):
                    mm._g = True
                    return mm
                mm.get = get
                return mm
            u.messages = messages
            return u
        svc = Svc()
        svc.users = users
        return svc

    def _run(self, include_seen):
        gc.get_gmail_service   = lambda: self._fake_service()
        gc.load_seen           = lambda: {"M1"}
        gc.save_seen           = lambda s: None
        gc.get_attachment_data = lambda service, msg_id, part: b"x" * 10000
        gc.is_whitelisted_sender = lambda s: True
        gc.is_inline_part        = lambda part, name: False
        return gc.fetch_invoice_attachments(days_back=30, include_seen=include_seen)

    # El filtrado por gmail_seen.json se retiro a proposito: ese archivo vivia en el
    # disco de Railway, se borraba en cada redespliegue y no lo compartia el equipo.
    # Ahora quien recuerda lo ya atendido es la coleccion gmail_revisados de Firestore.
    # include_seen se sigue aceptando por compatibilidad con clientes viejos, pero YA NO
    # cambia el resultado — y esta prueba existe para que eso siga siendo cierto.
    # (Antes afirmaba lo contrario y llevaba meses en rojo sin que nadie la corriera.)
    def test_include_seen_ya_no_cambia_el_resultado(self):
        con = self._run(True)
        sin = self._run(False)
        self.assertEqual(len(con), 1)
        self.assertEqual(len(sin), 1, "el registro de vistos del servidor ya no filtra")
        self.assertEqual(con[0]["msg_id"], sin[0]["msg_id"], "M1")



# ════════════════════════════════════════════════════════════════════════════
# Guardias del token de Gmail
# ════════════════════════════════════════════════════════════════════════════
# Un refresh_token de Gmail de este proyecto terminó en el historial público del
# repositorio y estuvo ahí tres meses. Estas pruebas no arreglan aquello —eso se
# revoca en Google— pero cierran las dos puertas por las que volvió a pasar:
# versionar el archivo, e imprimir el token en la terminal al generarlo.
sys.modules.setdefault("google_auth_oauthlib", types.ModuleType("google_auth_oauthlib"))
_flow_mod = types.ModuleType("google_auth_oauthlib.flow")
_flow_mod.InstalledAppFlow = object
sys.modules.setdefault("google_auth_oauthlib.flow", _flow_mod)

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
import generar_token_gmail as gt


class TestTokenNoSeVersiona(unittest.TestCase):
    def test_gmail_token_no_esta_en_el_arbol_de_git(self):
        import subprocess
        r = subprocess.run(["git", "ls-files", "gmail_token.json", "gmail_credentials.json"],
                           cwd=str(RAIZ), capture_output=True, text=True)
        self.assertEqual(r.stdout.strip(), "",
                         "gmail_token.json o gmail_credentials.json volvieron a versionarse")

    def test_el_gitignore_los_cubre(self):
        ignore = (RAIZ / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("gmail_token.json", ignore)
        self.assertIn("gmail_credentials.json", ignore)


class TestGeneradorNoImprimeElToken(unittest.TestCase):
    def test_el_codigo_no_imprime_el_json_del_token(self):
        src = (RAIZ / "generar_token_gmail.py").read_text(encoding="utf-8")
        self.assertNotIn("print(token_json)", src,
                         "el generador volvió a imprimir el token en pantalla")

    def test_escribir_privado_deja_el_archivo_solo_para_el_dueno(self):
        import stat, tempfile
        with tempfile.TemporaryDirectory() as d:
            ruta = Path(d) / "token.json"
            aplico = gt.escribir_privado(ruta, '{"refresh_token":"no-es-real"}')
            self.assertEqual(ruta.read_text(encoding="utf-8"), '{"refresh_token":"no-es-real"}')
            if aplico:   # en Windows los permisos POSIX no aplican
                modo = stat.S_IMODE(ruta.stat().st_mode)
                self.assertEqual(modo, 0o600, f"quedó en {oct(modo)}, no en 0o600")

    def test_escribir_privado_corrige_un_archivo_que_ya_estaba_abierto(self):
        # O_CREAT no cambia los permisos de un archivo existente: si el token ya
        # estaba ahí con 0644, sin el chmod posterior seguiría siendo legible.
        import stat, tempfile
        with tempfile.TemporaryDirectory() as d:
            ruta = Path(d) / "token.json"
            ruta.write_text("viejo", encoding="utf-8")
            ruta.chmod(0o644)
            if gt.escribir_privado(ruta, "nuevo"):
                self.assertEqual(stat.S_IMODE(ruta.stat().st_mode), 0o600)

    def test_sin_herramienta_de_portapapeles_no_truena(self):
        original = gt.shutil.which
        gt.shutil.which = lambda _c: None
        try:
            self.assertEqual(gt.copiar_al_portapapeles("lo que sea"), "")
        finally:
            gt.shutil.which = original

if __name__ == "__main__":
    unittest.main(verbosity=2)
