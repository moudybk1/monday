// Entry point for the evidence worker thread. Worker threads do not inherit the TypeScript loader the main
// thread runs under (tsx), so a thread started on evidence.ts fails with "Unknown file extension .ts".
// This registers the loader inside the thread, then loads the TypeScript module it was given.
import { register } from 'tsx/esm/api';
import { workerData } from 'node:worker_threads';

register();
await import(workerData.entry);
