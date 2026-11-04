import path from 'node:path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { ApiError } from '../utils/ApiError.js';

const SUPPORTED = new Set(['.pdf', '.docx', '.txt', '.md', '.markdown']);
const MODAL = /\b(shall|must|should|may|will)\b/i;
const NON_FUNCTIONAL =
  /(performance|latency|throughput|availability|security|encrypt|usability|accessib|scalab|maintainab|reliab|response time|uptime|privacy|gdpr|backup|retention)/i;
const CONSTRAINT =
  /(constraint|restriction|must use|limited to|complies with|compliance|standard|regulation|architecture)/i;

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractTextFromFile(file) {
  if (!file || !file.buffer) throw new ApiError(400, 'No file received');

  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!SUPPORTED.has(ext)) {
    throw new ApiError(415, `Unsupported file type "${ext}". Allowed: ${[...SUPPORTED].join(', ')}`);
  }

  try {
    if (ext === '.pdf') {
      const data = await pdfParse(file.buffer);
      return normalizeWhitespace(data.text);
    }
    if (ext === '.docx') {
      const { value } = await mammoth.extractRawText({ buffer: file.buffer });
      return normalizeWhitespace(value);
    }
    return normalizeWhitespace(file.buffer.toString('utf8'));
  } catch (err) {
    throw new ApiError(422, `Could not read the uploaded file: ${err.message}`);
  }
}

function classify(text, code) {
  if (code && /^NFR/i.test(code)) return 'non-functional';
  if (code && /^FR/i.test(code)) return 'functional';
  if (NON_FUNCTIONAL.test(text)) return 'non-functional';
  if (CONSTRAINT.test(text)) return 'constraint';
  if (MODAL.test(text)) return 'functional';
  return 'unknown';
}

/**
 * Splits free text into requirement statements. Preserves explicit FR-NN /
 * NFR-NN codes when present (the SRS generator writes them) and falls back to
 * synthetic R-NNN codes otherwise.
 */
export function segmentRequirements(rawText) {
  const text = normalizeWhitespace(rawText);
  if (!text) return [];

  const candidates = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const sentences = trimmed.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const cleaned = sentence.replace(/^[-*•\s]+/, '').trim();

      // Preserve explicit "FR-01: …" / "NFR-02: …" prefixes
      const m = cleaned.match(/^([A-Z]{2,}-\d+)\s*[:.)]\s*(.+)$/);
      if (m) {
        const body = m[2].trim();
        if (body.length >= 15) candidates.push({ code: m[1], text: body });
      } else {
        const stripped = cleaned.replace(/^\d+[.)]\s*/, '').trim();
        if (stripped.length >= 15) candidates.push({ code: null, text: stripped });
      }
    }
  }

  let pool = candidates.filter((c) => c.code || MODAL.test(c.text));
  if (pool.length === 0) pool = candidates;

  const seen = new Set();
  const unique = [];
  for (const c of pool) {
    const key = c.text.toLowerCase().slice(0, 140);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
    if (unique.length >= 300) break;
  }

  let counter = 1;
  return unique.map((c) => ({
    code: c.code || `R-${String(counter++).padStart(3, '0')}`,
    text: c.text,
    type: classify(c.text, c.code)
  }));
}