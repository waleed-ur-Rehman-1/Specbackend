import { env } from '../config/env.js';
import { callLLM } from './llm/adapter.js';
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
  buildCorrectionPrompt
} from './llm/prompts.js';
import { extractionSchema, EMPTY_MODEL } from './llm/schema.js';
import { mockExtract } from './mockExtraction.js';

const MAX_ATTEMPTS = 2;

function stripFences(text) {
  let out = String(text || '').trim();
  if (out.startsWith('```')) {
    out = out.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
  }
  return out.trim();
}

function normalizeResult(raw) {
  const result = { ...EMPTY_MODEL, ...raw };

  if (!Array.isArray(result.actors) || result.actors.length === 0) {
    result.actors = [{ name: 'User', description: 'Default actor', sourceRequirementCodes: [] }];
  }
  const actorNames = new Set(result.actors.map((a) => a.name));

  result.useCases = (result.useCases || []).map((uc) => ({
    ...uc,
    actors: (uc.actors || []).filter((a) => actorNames.has(a))
  }));
  for (const uc of result.useCases) {
    if (uc.actors.length === 0) uc.actors = [result.actors[0].name];
  }

  const classNames = new Set((result.classes || []).map((c) => c.name));
  result.relationships = (result.relationships || []).filter(
    (r) => classNames.has(r.source) && classNames.has(r.target) && r.source !== r.target
  );

  return result;
}

export async function extractModel({ requirements, rawSrsText = '' }) {
  const startedAt = Date.now();
  const parameters = {
    temperature: env.llm.temperature,
    maxTokens: env.llm.maxTokens,
    strategy: 'schema-constrained-json'
  };
  const baseMeta = {
    provider: env.llm.provider,
    model: env.llm.model,
    promptTemplate: 'extraction.v1',
    parameters
  };

  // Offline / demo mode
  if (env.llm.provider === 'mock' || (!env.llm.apiKey && env.llm.provider !== 'ollama')) {
    const parsed = extractionSchema.safeParse(mockExtract(requirements, rawSrsText));
    const result = normalizeResult(parsed.success ? parsed.data : EMPTY_MODEL);
    return {
      result,
      meta: {
        ...baseMeta,
        provider: 'mock',
        model: 'heuristic-v1',
        tokensUsed: 0,
        status: 'success',
        rawOutput: JSON.stringify(result).slice(0, 20000),
        durationMs: Date.now() - startedAt
      }
    };
  }

  const userPrompt = buildExtractionUserPrompt(requirements);
  let lastRaw = '';
  let lastErrors = '';
  let tokensUsed = 0;
  let usedModel = env.llm.model;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const prompt =
        attempt === 1
          ? userPrompt
          : `${userPrompt}\n\n${buildCorrectionPrompt(lastRaw, lastErrors)}`;

      const llm = await callLLM({ system: EXTRACTION_SYSTEM_PROMPT, user: prompt });
      lastRaw = llm.text;
      tokensUsed += llm.usage.totalTokens || 0;
      usedModel = llm.model || usedModel;

      let parsedJson;
      try {
        parsedJson = JSON.parse(stripFences(llm.text));
      } catch (err) {
        lastErrors = `Response was not valid JSON: ${err.message}`;
        continue;
      }

      const validation = extractionSchema.safeParse(parsedJson);
      if (validation.success) {
        return {
          result: normalizeResult(validation.data),
          meta: {
            ...baseMeta,
            model: usedModel,
            tokensUsed,
            status: 'success',
            rawOutput: String(lastRaw).slice(0, 50000),
            durationMs: Date.now() - startedAt
          }
        };
      }

      lastErrors = validation.error.issues
        .slice(0, 10)
        .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
    } catch (err) {
      lastErrors = err.message;
    }
  }

  // Graceful degradation — never crash the pipeline (NFR-05)
  const parsed = extractionSchema.safeParse(mockExtract(requirements, rawSrsText));
  const fallback = normalizeResult(parsed.success ? parsed.data : EMPTY_MODEL);
  return {
    result: fallback,
    meta: {
      ...baseMeta,
      model: usedModel,
      tokensUsed,
      status: 'partial',
      rawOutput: String(lastRaw || lastErrors).slice(0, 50000),
      durationMs: Date.now() - startedAt
    }
  };
}