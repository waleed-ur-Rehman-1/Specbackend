import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.routes.js';
import projectRoutes from './routes/project.routes.js';
import documentRoutes from './routes/document.routes.js';
import exportRoutes from './routes/export.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';      // NEW
import { notFound, errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(cors({ origin: env.clientOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.json({ name: 'SpecForge API', status: 'running', health: '/api/health' });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, provider: env.llm.provider, model: env.llm.model });
});

// Serverless invocations do not execute src/index.js.
app.use('/api', (req, res, next) => {
  connectDB().then(() => next()).catch(next);
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/dashboard', dashboardRoutes);                      // NEW
app.use('/api', documentRoutes);
app.use('/api', exportRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
