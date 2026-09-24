/** Renderer only. Importing does not read input, start a service or create files. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseDocument } from "yaml";
import {
  compile_reader_exposure,
  type Allocation,
  type Selection,
  type PublicTrust,
} from "./m4-native-reader.js";
export function renderReaderInput(raw: string) {
  if (Buffer.byteLength(raw) > 1_000_000) throw new Error("reader input bound");
  JSON.parse(raw); // Require JSON, even though the duplicate-key validator uses YAML's parser.
  const parsed = parseDocument(raw, {
    schema: "json",
    uniqueKeys: true,
    merge: false,
  });
  if (parsed.errors.length) throw new Error("ambiguous reader input");
  const input = parsed.toJS() as {
    allocation: Allocation;
    exactSelection: Selection;
    publicTrust: PublicTrust;
  };
  if (
    !input ||
    Object.keys(input).sort().join() !== "allocation,exactSelection,publicTrust"
  )
    throw new Error("exact renderer fields required");
  return compile_reader_exposure(
    input.allocation,
    input.exactSelection,
    input.publicTrust,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length !== 3)
    throw new Error("usage: node m4-native-reader-cli.js public-input.json");
  process.stdout.write(
    JSON.stringify(
      renderReaderInput(readFileSync(process.argv[2]!, "utf8")),
      null,
      2,
    ) + "\n",
  );
}
