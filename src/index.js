import app from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';

async function start() {
  try {
    await connectDB();
    app.listen(env.port, () => {
      console.log(`[server] listening on http://localhost:${env.port}`);
      console.log(`[server] LLM provider: ${env.llm.provider}`);
    });
  } catch (err) {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  }
}

start();