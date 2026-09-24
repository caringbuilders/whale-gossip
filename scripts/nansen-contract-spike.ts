import { runSpikeCommand, type AttemptReport } from "../lib/server/nansen-spike-runner";

function printAttempt(report: AttemptReport): void {
  console.log(JSON.stringify(report, null, 2));
}

void runSpikeCommand(process.argv.slice(2), { onAttempt: printAttempt })
  .then((result) => {
    if (result.mode !== "live") console.log(JSON.stringify(result, null, 2));
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown contract-spike failure";
    console.error(message);
    process.exitCode = 1;
  });
