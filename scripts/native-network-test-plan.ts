/** Offline inputs only. Never use this fixture's trust pins for native admission. */
import { writeFileSync } from "node:fs";
import { offlineReaderExposures } from "../tests/fixtures/full-host-readers.js";
import { compileNativeFullHostNetwork } from "../src/native-full-host-network.js";
import { compileNativeFullHostServiceExposures } from "../src/native-full-host-exposure.js";
import { FULL_HOST_SEALER_IMAGE } from "../src/native-full-host-environment.js";
import { PROXY_IMAGE } from "../src/m4-native-reader.js";

const [plan, directory] = process.argv.slice(2);
if (!plan || !directory)
  throw new Error("explicit unit plan and proxy output directory required");
const readers = offlineReaderExposures();
writeFileSync(plan, JSON.stringify(compileNativeFullHostNetwork(readers)));
const exposure = compileNativeFullHostServiceExposures(readers);
writeFileSync(
  `${directory}/images.json`,
  JSON.stringify({ sealer: FULL_HOST_SEALER_IMAGE, proxy: PROXY_IMAGE }),
);
for (const proxy of [...exposure.readers, ...exposure.publicServices])
  writeFileSync(`${directory}/${proxy.role}.json`, JSON.stringify(proxy.envoy));
