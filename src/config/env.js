import dotenv from 'dotenv';
dotenv.config();

export const env = {
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/specforge',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  plantumlServer: process.env.PLANTUML_SERVER || 'https://www.plantuml.com/plantuml',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 20),
  llm: {
    provider: (process.env.LLM_PROVIDER || 'mock').toLowerCase(),
    apiKey: process.env.LLM_API_KEY || '',
    baseUrl: (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    temperature: Number(process.env.LLM_TEMPERATURE ?? 0.1),
    maxTokens: Number(process.env.LLM_MAX_TOKENS || 4000)
  }
};

if (env.jwtSecret === 'dev-secret-change-me') {
  console.warn('[env] Using default JWT_SECRET — set a real one before deploying.');
}