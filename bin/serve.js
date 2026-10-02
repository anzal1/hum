// Background entry used by the terminal commands: run the hum server, say nothing.
import { startServer } from '../server.js';

const port = Number(process.env.HUM_PORT) || Number(process.env.PORT) || 3737;
startServer({ port, log: () => {} }).catch(() => process.exit(1));
