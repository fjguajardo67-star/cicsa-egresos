"""Regresión C02: rutas reales de Flask; sin cuentas, Gmail, IA ni datos reales."""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auth_cicsa as policy
import servidor_cicsa as server


class BackendAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.claims = {"sub": "staff", "iss": f"https://securetoken.google.com/{policy.PROJECT}"}
        self.verifier = self.enterContext(patch("google.oauth2.id_token.verify_firebase_token", return_value=self.claims))
        self.response = Mock(status_code=200)
        self.response.json.return_value = {"fields": {"rol": {"stringValue": "operativo"}}}
        self.lookup = self.enterContext(patch("auth_cicsa.requests.get", return_value=self.response))
        self.enterContext(patch.object(server, "IS_RAILWAY", True))
        self.headers = {"Authorization": "Bearer test-only"}

    def status(self):
        return self.client.get("/gmail-status", headers=self.headers)

    def test_missing_and_malformed_bearer_never_reach_verification(self):
        for value in ("", "Basic abc", "Bearer ", "Bearer " + "a" * 8192):
            with self.subTest(value=value[:12]):
                self.assertEqual(self.client.get("/gmail-status", headers={"Authorization": value}).status_code, 401)
        self.verifier.assert_not_called()
        self.lookup.assert_not_called()

    def test_anonymous_routes_denied_in_local_and_railway(self):
        for deployed in (False, True):
            with patch.object(server, "IS_RAILWAY", deployed):
                for route in server.app.url_map.iter_rules():
                    if route.endpoint in {"static", "static_files", "index", "status", "precios_ingredientes_options"}:
                        continue
                    method = "POST" if "POST" in route.methods else "GET"
                    with self.subTest(route=route.rule, deployed=deployed):
                        response = self.client.open(route.rule, method=method, json={} if method == "POST" else None)
                        self.assertEqual(response.status_code, 401)
        self.lookup.assert_not_called()

    def test_bad_signature_never_checks_membership(self):
        self.verifier.side_effect = ValueError("invalid signature")
        self.assertEqual(self.status().status_code, 401)
        self.lookup.assert_not_called()

    def test_wrong_issuer_denied(self):
        self.claims["iss"] = "https://issuer.invalid"
        self.assertEqual(self.status().status_code, 403)
        self.lookup.assert_not_called()

    def test_invalid_uid_denied_without_lookup(self):
        for uid in ("", None, 12, "x" * 129):
            self.claims["sub"] = uid
            self.assertEqual(self.status().status_code, 403)
        self.lookup.assert_not_called()

    def test_unapproved_account_denied(self):
        for status in (403, 404):
            self.response.status_code = status
            self.assertEqual(self.status().status_code, 403)

    def test_active_staff_and_legacy_members_allowed(self):
        for fields in ({}, {"rol": {"stringValue": "operativo"}, "activo": {"booleanValue": True}}):
            self.response.json.return_value = {"fields": fields}
            self.assertEqual(self.status().status_code, 200)
        kwargs = self.lookup.call_args.kwargs
        self.assertEqual(kwargs["timeout"], (5, 10))
        self.assertFalse(kwargs["allow_redirects"])
        self.assertEqual(self.verifier.call_args.kwargs["audience"], policy.PROJECT)

    def test_inactive_and_malformed_active_are_denied(self):
        for uid in ("staff", policy.OWNER_UID):
            self.claims["sub"] = uid
            for active in ({"booleanValue": False}, {"booleanValue": 1}, {"stringValue": "true"}, None, {}):
                with self.subTest(uid=uid, active=active):
                    self.response.json.return_value = {"fields": {"activo": active}}
                    self.assertEqual(self.status().status_code, 403)

    def test_bad_roles_cannot_gain_access(self):
        for role in ({"stringValue": "owner"}, {"booleanValue": True}, None, {}):
            self.response.json.return_value = {"fields": {"rol": role}}
            self.assertEqual(self.status().status_code, 403)

    def test_bad_document_denied(self):
        for document in ([], {}, {"fields": []}, {"fields": None}):
            self.response.json.return_value = document
            self.assertEqual(self.status().status_code, 403)

    def test_admin_routes_denied_to_staff_before_operation(self):
        with patch("gmail_cicsa.revoke_and_reauthorize") as renew, patch.object(server, "fetch_invoice_attachments") as fetch:
            for path in ("/gmail-renovar", "/gmail-debug", "/gmail-reset-seen"):
                self.assertEqual(self.client.post(path, json={}, headers=self.headers).status_code, 403)
            renew.assert_not_called()
            fetch.assert_not_called()

    def test_active_admin_allowed_to_renew(self):
        self.response.json.return_value = {"fields": {"rol": {"stringValue": "admin"}}}
        with patch("gmail_cicsa.revoke_and_reauthorize", return_value=Mock()) as renew:
            response = self.client.post("/gmail-renovar", json={}, headers=self.headers)
            self.assertEqual(response.status_code, 200)
            renew.assert_called_once()

    def test_owner_bootstrap_requires_explicit_not_found(self):
        self.claims["sub"] = policy.OWNER_UID
        self.response.status_code = 404
        self.assertEqual(self.status().status_code, 200)
        self.response.status_code = 403
        self.assertEqual(self.status().status_code, 403)

    def test_upstream_failure_does_not_grant_owner_access(self):
        for uid in ("staff", policy.OWNER_UID):
            self.claims["sub"] = uid
            for status in (301, 401, 429, 500, 503):
                self.response.status_code = status
                self.assertEqual(self.status().status_code, 503)

    def test_network_failure_is_sanitized_and_denied(self):
        self.lookup.side_effect = policy.requests.Timeout("secret-marker-must-not-escape")
        response = self.status()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret-marker", response.get_data(as_text=True))

    def test_membership_is_rechecked_after_deactivation(self):
        self.assertEqual(self.status().status_code, 200)
        self.response.json.return_value = {"fields": {"activo": {"booleanValue": False}}}
        self.assertEqual(self.status().status_code, 403)
        self.assertEqual(self.lookup.call_count, 2)

    def test_role_is_rechecked_after_demotion(self):
        self.response.json.return_value = {"fields": {"rol": {"stringValue": "admin"}}}
        with patch("gmail_cicsa.revoke_and_reauthorize", return_value=Mock()) as renew:
            self.assertEqual(self.client.post("/gmail-renovar", json={}, headers=self.headers).status_code, 200)
            self.response.json.return_value = {"fields": {"rol": {"stringValue": "operativo"}}}
            self.assertEqual(self.client.post("/gmail-renovar", json={}, headers=self.headers).status_code, 403)
            renew.assert_called_once()

    def test_live_status_identifies_the_release(self):
        self.assertEqual(self.client.get("/status").json["security_release"], "authorization-v1")


if __name__ == "__main__":
    unittest.main()
