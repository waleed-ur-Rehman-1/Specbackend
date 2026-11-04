import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const ALLOWED = new Set(['.pdf', '.docx', '.txt', '.md', '.markdown']);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED.has(ext)) {
      return cb(new ApiError(415, `Unsupported file type "${ext}". Allowed: ${[...ALLOWED].join(', ')}`));
    }
    cb(null, true);
  }
});