import { buildApp } from './app.js';
import { getConfig } from './config/env.js';

const config = getConfig();
const app = await buildApp();

await app.listen({ host: config.HOST, port: config.PORT });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'API shutdown requested');
  await app.close();
}

process.once('SIGINT', () => void shutdown('SIGINT').finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown('SIGTERM').finally(() => process.exit(0)));
