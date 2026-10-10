// The Perpl stats indexer as its own process: npm run indexer. A server trading real funds does not index in-process,
// because the indexer's synchronous SQLite batches can stall the event loop past Perpl's ping timeout and drop the
// trading socket. Both processes share the stats database (WAL), and the server reads the indexer's progress from it.

import { config } from '../config';
import { startIndexer } from './indexer';

if (!config.realFunds) {
  console.log(JSON.stringify({ service: 'indexer', event: 'skipped', reason: 'the server indexes in-process when it does not trade real funds' }));
  process.exit(0);
}
startIndexer();
console.log(JSON.stringify({ service: 'indexer', event: 'started', network: config.network }));
