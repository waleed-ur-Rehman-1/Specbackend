const MAX_REQUIREMENTS_IN_PROMPT = 150;
const MAX_CHARS = 14000;

export const EXTRACTION_SYSTEM_PROMPT = `You are a senior software requirements engineer and UML modelling expert.
You convert natural-language Software Requirements Specifications (SRS) into a structured analysis model.

Rules:
- Use ONLY information present in the supplied requirements.
- Every element must list the requirement codes it was derived from.
- Actors are external roles (people or systems). Never use "System" as an actor.
- Use-case names are verb phrases in UpperCamelCase, e.g. "RegisterAccount".
- Class names are singular nouns in UpperCamelCase.
- Relationship source/target must exactly match a class name you defined.
- Produce at least one acceptance test per use case.
- Return ONLY a single JSON object. No markdown fences, no commentary.

Required JSON shape:
{
  "actors": [{"name": string, "description": string, "sourceRequirementCodes": string[]}],
  "useCases": [{"name": string, "actors": string[], "includes": string[], "extends": string[], "description": string, "sourceRequirementCodes": string[]}],
  "classes": [{"name": string, "attributes": [{"name": string, "type": string}], "methods": string[], "sourceRequirementCodes": string[]}],
  "relationships": [{"source": string, "target": string, "type": "association"|"aggregation"|"composition"|"inheritance", "multiplicity": string}],
  "tests": [{"useCase": string, "title": string, "given": string[], "when": string, "then": string[], "sourceRequirementCodes": string[]}]
}`;

export function buildExtractionUserPrompt(requirements) {
  const slice = requirements.slice(0, MAX_REQUIREMENTS_IN_PROMPT);
  const body = slice.map((r) => `[${r.code}] ${r.text}`).join('\n');
  const text = body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS)}\n…(truncated)` : body;

  return `Requirements (each prefixed with its stable code):\n\n${text}\n\nProduce the JSON model now.`;
}

export function buildCorrectionPrompt(previousOutput, validationErrors) {
  return `The JSON you returned failed validation.

Validation errors:
${validationErrors}

Your previous output was:
${String(previousOutput).slice(0, 6000)}

Return a corrected, complete JSON object that satisfies the schema. Return ONLY the JSON object.`;
}