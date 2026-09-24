"""Init-container only: close an explicitly planned disposable pod network.

This does not admit native traffic. All service containers start after this init
container exits successfully, without NET_ADMIN or any other Linux capability.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def digest(value):
    return "sha256:" + hashlib.sha256(value).hexdigest()


def command(argv):
    return subprocess.run(argv, check=True, capture_output=True, timeout=10).stdout


def check_plan(plan, expected):
    if (
        plan.get("schemaVersion") != "juntai.platform/native-full-host-network/v1"
        or plan.get("externalInterfaces") is not False
        or plan.get("credentialForwardingBridges") is not False
        or plan.get("nativeAdmission") is not False
        or digest(plan["nft"].encode()) != expected
        or plan["policySha256"] != expected
    ):
        raise ValueError("exact isolated full-host network plan required")
    pairs = []
    for edge in plan["edges"]:
        if (
            edge["address"] != "127.0.0.1"
            or type(edge["uid"]) is not int
            or not 21000 < edge["uid"] < 21100
            or type(edge["port"]) is not int
            or not 1024 <= edge["port"] <= 65535
            or plan["uids"].get(edge["role"]) != edge["uid"]
            or plan["listeners"].get(edge["target"]) != edge["port"]
        ):
            raise ValueError("unbounded or ambiguous planned network edge")
        pairs.append((edge["uid"], edge["port"]))
    if not pairs or len(set(pairs)) != len(pairs):
        raise ValueError("unique bounded network edges required")
    expected_redirects = [
        {"role": role, "uid": uid, "address": "127.0.0.1", "port": 9443, "targetPort": 19443}
        for role, uid in (("nous", 21002), ("lattice", 21005), ("independentClient", 21012))
    ]
    if plan.get("issuerRedirects") != expected_redirects:
        raise ValueError("host issuer traffic must use the restricted token/JWKS listener")


def match(left, right, op="=="):
    return {"match": {"op": op, "left": left, "right": right}}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def check_links(links):
    # Linux may recreate these unconfigured tunnel templates on deletion. They
    # have no peer, address or UP flag; service processes cannot activate them
    # because their capability sets are empty. Never accept a veth or bridge.
    fallback = {
        "tunl0": "ipip", "gre0": "gre", "gretap0": "gretap",
        "erspan0": "erspan", "ip_vti0": "vti", "ip6_vti0": "vti6",
        "sit0": "sit", "ip6tnl0": "ip6tnl", "ip6gre0": "ip6gre",
    }
    loopback, dormant = [], []
    for link in links:
        if link["ifname"] == "lo":
            loopback.append(link)
            continue
        info = link.get("linkinfo", {})
        data = info.get("info_data", {})
        if (
            link["ifname"] not in fallback
            or fallback[link["ifname"]] != info.get("info_kind")
            or link.get("operstate") != "DOWN"
            or "UP" in link["flags"]
            or link.get("addr_info") != []
            or link.get("link") is not None
            or link.get("link_netnsid") is not None
            or data.get("remote") != "any"
            or data.get("local") != "any"
            or data.get("link") not in (None, 0)
        ):
            raise ValueError("external or configured non-loopback interface remains")
        dormant.append({"name": link["ifname"], "kind": info["info_kind"], "state": "DOWN"})
    if len(loopback) != 1 or "UP" not in loopback[0]["flags"]:
        raise ValueError("loopback must be up")
    return dormant


def check_rules(plan, rules):
    """Compare the actual kernel rules to the full plan, ignoring only handles."""
    tables, chains, actual = [], {}, []
    for entry in rules["nftables"]:
        if "metainfo" in entry:
            continue
        if set(entry) == {"table"}:
            value = dict(entry["table"])
            value.pop("handle", None)
            tables.append(value)
        elif set(entry) == {"chain"}:
            value = dict(entry["chain"])
            value.pop("handle", None)
            name = value.pop("name")
            if name in chains:
                raise ValueError("duplicate kernel chain")
            chains[name] = value
        elif set(entry) == {"rule"}:
            value = dict(entry["rule"])
            value.pop("handle", None)
            actual.append(value)
        else:
            raise ValueError("unexpected kernel network object")
    if tables != [{"family": "inet", "name": "nous_full_host"}]:
        raise ValueError("unexpected kernel tables")
    expected_chains = {
        name: {
            "family": "inet", "table": "nous_full_host", "type": "filter",
            "hook": name, "prio": 0, "policy": "drop",
        }
        for name in ("input", "output")
    }
    expected_chains["issuer_select"] = {
        "family": "inet", "table": "nous_full_host", "type": "nat",
        "hook": "output", "prio": -100, "policy": "accept",
    }
    if chains != expected_chains:
        raise ValueError("kernel default-deny chains differ")
    expected = []
    def rule(chain, expr):
        return {"family": "inet", "table": "nous_full_host", "chain": chain, "expr": expr}
    for edge in plan["issuerRedirects"]:
        expected.append(rule("issuer_select", [
            match({"meta": {"key": "skuid"}}, edge["uid"]),
            match({"payload": {"protocol": "ip", "field": "daddr"}}, "127.0.0.1"),
            match({"payload": {"protocol": "tcp", "field": "dport"}}, edge["port"]),
            {"redirect": {"port": edge["targetPort"]}},
        ]))
    # nft uses a bitmask match for the comma-separated conntrack state list.
    state = match({"ct": {"key": "state"}}, ["established", "related"], "in")
    expected.append(rule("output", [state, {"accept": None}]))
    for edge in plan["edges"]:
        expected.append(rule("output", [
            match({"meta": {"key": "skuid"}}, edge["uid"]),
            match({"payload": {"protocol": "ip", "field": "daddr"}}, "127.0.0.1"),
            match({"payload": {"protocol": "tcp", "field": "dport"}}, edge["port"]),
            {"accept": None},
        ]))
    expected.append(rule("input", [match({"meta": {"key": "iifname"}}, "lo"), {"accept": None}]))
    if actual != expected:
        raise ValueError("kernel allow rules differ from the exact plan")


def seal(plan_file, expected, receipt, *, run=command):
    namespace, pod_uid = os.environ.get("POD_NAMESPACE", ""), os.environ.get("POD_UID", "")
    if (
        sys.platform != "linux"
        or os.geteuid() != 0
        or not re.fullmatch(r"nous-full-host-t[0-9]+", namespace)
        or not re.fullmatch(r"[a-f0-9-]{36}", pod_uid)
    ):
        raise ValueError("planned disposable Linux pod init context required")
    plan = json.loads(Path(plan_file).read_bytes())
    check_plan(plan, expected)
    before = json.loads(run(["nft", "-j", "list", "ruleset"]))
    if any(set(entry) != {"metainfo"} for entry in before["nftables"]):
        raise ValueError("fresh pod network namespace required; never replace existing rules")
    policy = Path(receipt).with_suffix(".nft")
    policy.write_text(plan["nft"])
    run(["nft", "--check", "--file", str(policy)])
    run(["nft", "--file", str(policy)])
    check_rules(plan, json.loads(run(["nft", "-j", "list", "ruleset"])))
    links = json.loads(run(["ip", "-j", "link", "show"]))
    for link in links:
        name = link["ifname"]
        if name != "lo":
            if not re.fullmatch(r"[A-Za-z0-9_.-]{1,15}", name):
                raise ValueError("unexpected disposable network interface")
            run(["ip", "link", "delete", "dev", name])
    run(["ip", "link", "set", "dev", "lo", "up"])
    remaining = json.loads(run(["ip", "-d", "-j", "address", "show"]))
    dormant = check_links(remaining)
    observed = run(["nft", "-j", "list", "ruleset"])
    check_rules(plan, json.loads(observed))
    evidence = {
        "schemaVersion": "juntai.platform/native-full-host-network-receipt/v1",
        "namespace": namespace, "podUid": pod_uid,
        "networkNamespace": os.readlink("/proc/self/ns/net"),
        "policySha256": expected, "observedRulesSha256": digest(observed),
        "activeInterfaces": ["lo"], "inactiveKernelTunnelTemplates": dormant,
        "externalInterfaces": False, "nativeAdmission": False,
    }
    output = Path(receipt)
    output.write_text(canonical(evidence) + "\n")
    output.chmod(0o444)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply-to-disposable-pod", action="store_true", required=True)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--policy-sha256", required=True)
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args()
    seal(args.plan, args.policy_sha256, args.receipt)
