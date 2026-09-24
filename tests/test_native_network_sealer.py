import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("network_sealer", ROOT / "release/seal-full-host-network.py")
sealer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sealer)


class NetworkReadbackTests(unittest.TestCase):
    def setUp(self):
        self.links = json.loads((ROOT / "tests/fixtures/native-kernel-links.json").read_text())
        self.rules = json.loads((ROOT / "tests/fixtures/native-nft-rules.json").read_text())
        self.plan = json.loads((ROOT / "tests/fixtures/native-network-plan.json").read_text())

    def test_recorded_kernel_rules_are_understood(self):
        sealer.check_rules(self.plan, self.rules)

    def test_missing_extra_or_changed_rule_fails_closed(self):
        for kind in ("extra", "missing", "allow-all", "wrong-uid", "wrong-policy"):
            changed = copy.deepcopy(self.rules)
            rows = changed["nftables"]
            if kind == "extra":
                rows.append({"counter": {"family": "inet", "table": "other"}})
            elif kind == "missing":
                rows.pop()
            elif kind == "wrong-policy":
                next(row["chain"] for row in rows if row.get("chain", {}).get("name") == "output")["policy"] = "accept"
            else:
                rule = next(row["rule"] for row in rows if len(row.get("rule", {}).get("expr", [])) == 4)
                if kind == "allow-all":
                    rule["expr"] = [{"accept": None}]
                else:
                    rule["expr"][0]["match"]["right"] = 0
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                sealer.check_rules(self.plan, changed)

    def test_only_unconfigured_down_kernel_templates_survive(self):
        self.assertEqual(len(sealer.check_links(self.links)), len(self.links) - 1)
        for field, value in (("ifname", "eth0"), ("flags", ["UP"]), ("operstate", "UP"), ("link", "peer"), ("link_netnsid", 0), ("addr_info", [{"local": "10.0.0.1"}])):
            changed = copy.deepcopy(self.links)
            changed[1][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                sealer.check_links(changed)
        changed = copy.deepcopy(self.links)
        changed[1]["linkinfo"]["info_data"]["remote"] = "10.0.0.1"
        with self.assertRaises(ValueError):
            sealer.check_links(changed)
        with self.assertRaises(ValueError):
            sealer.check_links([])


if __name__ == "__main__":
    unittest.main()
