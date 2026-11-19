import 'dotenv/config';
import { createApp } from './bootstrap';
import { getConfig } from './config/config';

async function main() {
  const app = await createApp();
  await app.listen(getConfig().PORT);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
