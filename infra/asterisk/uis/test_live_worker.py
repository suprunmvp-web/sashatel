import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

from live_worker import Runtime, Worker
import test_uis


class Lab(Runtime):
    def __init__(self, path):
        self.path = path
        self.running = True
        self.loaded = None
        self.fail_start = False
        self.calls = 0
        self.starts = 0
        self.registered = True

    def drain(self):
        if self.calls:
            raise ValueError("active channels")
        self.running = False

    def start(self):
        if self.fail_start:
            self.fail_start = False
            raise subprocess.CalledProcessError(1, "start")
        self.loaded = os.readlink(self.path) if self.path.is_symlink() else None
        self.starts += 1
        self.running = True

    def cli(self, instruction, check=True):
        if not self.running:
            raise ValueError("stopped")
        status = "Registered" if self.registered else "Unregistered"
        outputs = {
            "core show uptime": "System uptime: 1 second",
            "pjsip show registrations": f" uis-smoke-registration/sip:mock.invalid  uis-smoke-auth   {status}",
            "dialplan show uis-smoke-dispatch": "[ Context 'uis-smoke-dispatch' created by 'pbx_config' ]",
            "pjsip show transport uis-smoke-transport": "Transport: uis-smoke-transport udp 0 0 9.9.9.9:5062",
        }
        return SimpleNamespace(stdout=outputs[instruction] if self.loaded else "")


def identifier():
    return str(uuid.uuid4())


class LiveWorkerTest(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.root = Path(work.name) / "managed"
        self.lab = Lab(self.root / "bundles/active")
        self.tenant, self.trunk = identifier(), identifier()
        self.worker = self.open_worker()
        fixture = test_uis.UisBundleTest()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.profile = fixture.profile
        self.secret = ("test-username", "test-password")

    def open_worker(self):
        return Worker(self.root, self.lab, self.tenant, self.trunk, os.getgid())

    def request(self, predecessor=None, enabled=True):
        return {"tenant_id": self.tenant, "trunk_id": self.trunk,
                "request_id": identifier(), "revision": identifier(),
                "expected_revision": predecessor, "enabled": enabled}

    def apply(self, request):
        return self.worker.apply(request, {**self.profile, "revision": request["revision"]},
                                 self.secret)

    def test_apply_deduplicate_restart_observe_disable(self):
        request = self.request()
        self.assertEqual(self.apply(request), "registered")
        self.assertEqual(self.apply(request), "registered")
        self.assertEqual(self.lab.starts, 1)
        bundle = self.root / "bundles" / request["revision"]
        self.assertEqual((bundle / "pjsip.conf").stat().st_mode & 0o777, 0o640)
        self.assertNotIn("test-password", (self.root / "manifest.json").read_text())
        self.lab.start()
        self.lab.registered = False
        self.assertEqual(self.open_worker().status()["status"], "applied")
        disable = self.request(request["revision"], enabled=False)
        self.assertEqual(self.worker.apply(disable), "disabled")
        self.assertEqual(self.open_worker().status()["revision"], disable["revision"])
        with self.assertRaises(ValueError):
            self.apply(self.request())

    def test_scope_and_revision_fail_without_runtime(self):
        for field in ("tenant_id", "trunk_id", "expected_revision"):
            request = self.request()
            request[field] = identifier()
            with self.assertRaises(ValueError):
                self.apply(request)
        self.assertEqual(self.lab.starts, 0)

    def test_failed_apply_rolls_back_previous_revision(self):
        previous = self.request()
        self.apply(previous)
        change = self.request(previous["revision"])
        self.lab.fail_start = True
        self.assertEqual(self.apply(change), "rolled_back")
        self.assertEqual(self.lab.loaded, previous["revision"])
        self.assertEqual(self.open_worker().status()["active_revision"], previous["revision"])

    def test_recover_pending_after_process_crash(self):
        previous = self.request()
        self.apply(previous)
        change = self.request(previous["revision"])
        with patch.object(self.worker, "switch", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.apply(change)
        # Simulate a crash after publishing the new pointer and before commit.
        self.worker.publish(change["revision"])
        self.lab.start()
        self.assertEqual(self.open_worker().status()["active_revision"], previous["revision"])
        self.assertEqual(self.lab.loaded, previous["revision"])
        self.assertEqual(self.apply(change), "rolled_back")

    def test_active_call_blocks_restart(self):
        self.lab.calls = 1
        with self.assertRaises(ValueError):
            self.apply(self.request())
        self.assertEqual(self.lab.starts, 0)
        self.assertFalse((self.root / "bundles/active").exists())
        self.lab.calls = 0
        self.assertEqual(self.open_worker().status()["status"], "disabled")


if __name__ == "__main__":
    unittest.main()
