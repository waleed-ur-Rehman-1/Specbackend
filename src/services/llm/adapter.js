import { env } from '../../config/env.js';

/**
 * Provider-agnostic LLM call. Any OpenAI-compatible endpoint works
 * (OpenAI, Groq, Together, Ollama's /v1, vLLM, LM Studio…).
 */
export async function callLLM({ system, user, jsonMode = true }) {
  const cfg = env.llm;

  if (cfg.provider === 'mock') {
    return { text: null, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: 'heuristic-v1' };
  }
  if (!cfg.apiKey && cfg.provider !== 'ollama') {
    throw new Error('LLM_API_KEY is not configured');
  }

  const body = {
    model: cfg.model,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  };
  if (jsonMode && cfg.provider !== 'ollama') {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  let response;
  try {
    response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    throw new Error(
      err.name === 'AbortError' ? 'LLM request timed out' : `LLM request failed: ${err.message}`
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LLM provider returned ${response.status}: ${detail.slice(0, 400)}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content ?? '';

  return {
    text,
    usage: {
      promptTokens: data?.usage?.prompt_tokens ?? 0,
      completionTokens: data?.usage?.completion_tokens ?? 0,
      totalTokens: data?.usage?.total_tokens ?? 0
    },
    model: data?.model || cfg.model
  };
}