import { pathToFileURL } from "node:url";

import { runAcquisitionCommand } from "../lib/server/nansen-acquisition-runner";

export async function main(arguments_: readonly string[] = process.argv.slice(2)): Promise<void> {
  const result = await runAcquisitionCommand(arguments_);
  console.log(JSON.stringify(result, null, 2));
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Acquisition command failed");
    process.exitCode = 1;
  });
}
