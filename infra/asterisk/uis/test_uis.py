import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class UisBundleTest(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.path = Path(work.name)
        self.profile = {
            "schema": 1, "revision": "v1", "bind_ipv4": "9.9.9.9",
            "registrar": "sip.example.net", "registrar_port": 5060,
            "proxy": "proxy.example.net", "proxy_port": 5060, "transport": "udp",
            "caller_id": "+12025550101", "destination": "+12025550102",
            "codecs": ["alaw"], "signaling_cidrs": ["8.8.8.8/32"],
            "rtp_cidrs": ["8.8.4.4/32"],
        }
        self.secret = self.path / "secret.json"
        self.secret.write_text(json.dumps({"username": "mock-user", "password": "mock-pass"}))
        self.secret.chmod(0o600)

    def run_cli(self, *args, ok=True):
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("uis.py")),
             str(self.path / "store"), *map(str, args)], capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, ok, result.stderr)
        self.assertNotIn("mock-pass", result.stderr + result.stdout)

    def stage(self, ok=True):
        profile = self.path / "profile.json"
        profile.write_text(json.dumps(self.profile))
        self.run_cli("stage", profile, self.secret, ok=ok)

    def test_staged_disabled_and_rollback(self):
        self.stage()
        store = self.path / "store"
        self.assertFalse((store / "active").exists())
        self.assertEqual((store / "v1/pjsip.conf").stat().st_mode & 0o777, 0o600)
        sip = (store / "v1/pjsip.conf").read_text()
        self.assertIn("bind=9.9.9.9:5062", sip)
        self.assertIn("context=uis-smoke-deny-ingress", sip)
        route = (store / "v1/extensions.conf").read_text()
        self.assertIn("Dial(PJSIP/+12025550102@uis-smoke,20,iL(30000))", route)
        self.assertNotIn("${EXTEN}", route)
        self.assertEqual(route.count("exten =>"), 1)
        self.assertNotIn("include =>", route)
        self.run_cli("select", "v1")
        self.profile["revision"] = "v2"
        self.stage()
        self.run_cli("select", "v2")
        self.assertEqual(os.readlink(store / "active"), "v2")
        self.run_cli("select", "../v1", ok=False)
        self.assertEqual(os.readlink(store / "active"), "v2")
        self.run_cli("select", "v1")
        self.assertEqual(os.readlink(store / "active"), "v1")
        self.run_cli("select", "off")
        self.assertFalse((store / "active").exists())

    def test_rejects_unsafe_profile_and_secret(self):
        for key, value in {
            "destination": "1001&Local/approved",
            "caller_id": "1234567\ninclude=>default",
            "registrar": "sip.example.net;extra",
            "rtp_cidrs": ["0.0.0.0/0"],
            "bind_ipv4": "0.0.0.0",
            "transport": "tls",
            "revision": "active",
        }.items():
            with self.subTest(key=key):
                previous = self.profile[key]
                self.profile[key] = value
                self.stage(ok=False)
                self.profile[key] = previous
        self.secret.chmod(0o644)
        self.stage(ok=False)
        self.secret.chmod(0o600)
        self.secret.write_text(json.dumps({"username": "mock-user", "password": "mock-pass\n[bad]"}))
        self.stage(ok=False)


if __name__ == "__main__":
    unittest.main()
