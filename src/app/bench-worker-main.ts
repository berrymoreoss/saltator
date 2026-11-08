/**
 * The entry of the runner bundle (`virtual:bench-runner`): starts the bench worker on the
 * worker's global scope. Nothing imports it; scripts/vite-bench-runner.ts bundles it.
 */
import { startBenchWorker, type WorkerScope, workerSyntaxLine } from './bench-worker';

startBenchWorker(self as unknown as WorkerScope, workerSyntaxLine);
