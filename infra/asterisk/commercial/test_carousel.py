"""Run directly: python3 -m unittest discover -s infra/asterisk/commercial -p 'test_*.py'"""
import unittest
from datetime import datetime, timezone
from carousel import Caller, capacity, eligible, human_reach, select


def c(number, *, used=0, held=0, active=True, approved=True, org="o", trunk="t", last=None):
    return Caller(number, org, trunk, active, approved, held, used, last)


class CarouselTests(unittest.TestCase):
    def test_eight_vs_ninth(self):
        pool = [c("+70000000001", used=8), c("+70000000002", used=7, held=1)]
        self.assertIsNone(select(pool, organization_id="o", trunk_id="t"))

    def test_next_free_least_loaded(self):
        pool = [c("+70000000001", used=7), c("+70000000002", used=3)]
        self.assertEqual(select(pool, organization_id="o", trunk_id="t").e164, "+70000000002")

    def test_tenant_and_status_isolation(self):
        pool = [c("x", used=0, org="other"), c("y", active=False),
                c("z", approved=False), c("ok", used=1)]
        self.assertEqual([x.e164 for x in eligible(pool, organization_id="o", trunk_id="t")], ["ok"])

    def test_least_recently_used_tiebreak(self):
        old = datetime(2026, 1, 1, tzinfo=timezone.utc)
        new = datetime(2026, 1, 2, tzinfo=timezone.utc)
        pool = [c("a", used=1, last=new), c("b", used=1, last=old)]
        self.assertEqual(select(pool, organization_id="o", trunk_id="t").e164, "b")

    def test_human_only_answers(self):
        self.assertEqual(human_reach(0, 80), 0)
        self.assertEqual(human_reach(40, 80), .5)
        self.assertIsNone(human_reach(0, 0))
        with self.assertRaises(ValueError): human_reach(81, 80)

    def test_capacity_100k_22_days(self):
        self.assertEqual(capacity(100000, 22), {
            "primary": 569, "reserve": 284, "target": 853, "order": 853
        })

    def test_inventory_avoids_duplicate_order(self):
        self.assertEqual(capacity(100000, 30, active_provisioned=100, ordered_pending=10)["order"], 516)

    def test_invalid(self):
        with self.assertRaises(ValueError): capacity(5000, 0)
        with self.assertRaises(ValueError): select([c("x", used=-1)], organization_id="o", trunk_id="t")


if __name__ == "__main__":
    unittest.main()
