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
    """El correo M1 ya está en 'vistos': con include_seen=False se salta; con True se devuelve.
    Es el fix para re-cargar facturas ya capturadas y re-leerlas con IA ('Leer igual')."""

    _PATCHED = ["get_gmail_service", "load_seen", "save_seen", "get_attachment_data",
                "is_whitelisted_sender", "is_inline_part"]

    def setUp(self):
        self._orig = {n: getattr(gc, n, None) for n in self._PATCHED}

    def tearDown(self):
        for n, fn in self._orig.items():
            setattr(gc, n, fn)

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

    def test_sin_include_seen_se_salta(self):
        self.assertEqual(self._run(False), [])

    def test_con_include_seen_se_devuelve(self):
        res = self._run(True)
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["msg_id"], "M1")


if __name__ == "__main__":
    unittest.main(verbosity=2)
