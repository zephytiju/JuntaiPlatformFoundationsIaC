import { createHash } from "node:crypto";
import {
  compile_reader_exposures,
  M4_PROFILE,
  PROXY_IMAGE,
  type Selection,
} from "../../src/m4-native-reader.js";

export function offlineReaderExposures() {
  const id = "33c0cb57-a3c6-4309-aa48-82e937522d7d";
  const sha = (value: string) =>
    "sha256:" + createHash("sha256").update(value).digest("hex");
  const hosts = ["nous", "lattice"] as const;
  return compile_reader_exposures(
    {
      id,
      profile: M4_PROFILE,
      isolatedSyntheticOnly: true,
      organizations: [`m4-${id}`, `m4-${id}-readers`, "juntai-system"],
      proxyImage: PROXY_IMAGE,
    },
    hosts.map((host, index): Selection => ({
      host,
      users: ["juntai-system/agent-self-01"],
      applications: [`admin/${id}-agent-self-${host}`],
      permissions: [`admin/${id}-agent-self-ceiling`],
      enforcer: `admin/${id}-tenant-policy`,
      enforcerTenant: `m4-${id}`,
      reader: {
        kind: "User",
        owner: `m4-${id}-readers`,
        name: host + "-reader",
        id: `${42 + index}c0cb57-a3c6-4309-aa48-82e937522d7d`,
        isAdmin: false,
        isGlobalAdmin: false,
        groups: [],
        roles: [],
      },
      readerAudience: host + "-reader-client",
    })),
    hosts.map((host) => ({
      caSha256: sha("OFFLINE CA"),
      jwksSha256: sha("OFFLINE JWKS"),
      serverCertificateSha256: sha(host + " OFFLINE SERVER"),
      clientCertificateSha256: sha(host + " OFFLINE CLIENT"),
      clientSan: `${host}.${id}.m4.invalid`,
      serverName: `${host}-reader.m4.invalid`,
    })),
  );
}
