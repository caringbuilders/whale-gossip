import { pathToFileURL } from "node:url";

import { runSpikeCommand, type AttemptReport } from "../lib/server/nansen-spike-runner";

function printAttempt(report: AttemptReport): void {
  console.log(JSON.stringify(report, null, 2));
}

export async function main(arguments_ = process.argv.slice(2)): Promise<void> {
  try {
    const result = await runSpikeCommand(arguments_, { onAttempt: printAttempt });
    if (result.mode !== "live" && result.mode !== "pagination-probe") console.log(JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown contract-spike failure";
    console.error(message);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) void main();
