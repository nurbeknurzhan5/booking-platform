import 'dotenv/config';
import { createApp } from './bootstrap';
import { getConfig } from './config/config';

async function main() {
  const app = await createApp();
  await app.listen(getConfig().PORT);
}

main().catch((err) => {
   
  console.error(err);
  process.exit(1);
});
