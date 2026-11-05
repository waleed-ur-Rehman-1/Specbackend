import mongoose from 'mongoose';
import { env } from './env.js';

let connectionPromise;

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  if (connectionPromise) return connectionPromise;
  mongoose.set('strictQuery', true);
  connectionPromise = mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await connectionPromise;
    console.log('[db] connected');
  } finally {
    connectionPromise = undefined;
  }
}
