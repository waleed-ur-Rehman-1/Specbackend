/* ============================================================= *
 * HEURISTIC MODEL EXTRACTOR
 * - Works with zero LLM configuration (LLM_PROVIDER=mock)
 * - Reads the enriched SRS produced by srsGenerator.service.js
 * - Pulls actors from bold entries, use cases from quoted names,
 *   classes from bold entities, and attributes from the entity table
 * ============================================================= */

const ACTOR_HINTS = [
  'user', 'admin', 'administrator', 'analyst', 'developer', 'tester',
  'customer', 'manager', 'researcher', 'reviewer', 'supervisor', 'student',
  'member', 'librarian', 'seller', 'author', 'reader', 'moderator', 'instructor',
  'patient', 'doctor', 'guest', 'organizer', 'attendee', 'teller', 'receptionist',
  'operator', 'owner', 'visitor', 'buyer', 'vendor', 'clerk', 'nurse'
];

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are',
  'be', 'shall', 'must', 'should', 'will', 'may', 'that', 'this', 'it', 'as', 'by',
  'from', 'at', 'all', 'any', 'each', 'user', 'users', 'system', 'can', 'not', 'no',
  'if', 'when', 'then', 'their', 'they', 'them', 'which', 'such', 'has', 'have',
  'been', 'was', 'were', 'into', 'than', 'also', 'more', 'most', 'other', 'only',
  'its', 'there', 'these', 'those', 'both', 'but', 'so', 'out', 'about', 'over',
  'after', 'before', 'between', 'under', 'during', 'without', 'within', 'able',
  'allow', 'allows', 'provide', 'provides', 'support', 'supports', 'using', 'use',
  'perform', 'role', 'core', 'domain', 'object', 'record', 'subsystem'
]);

const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* -------------------------------------------------------------- *
 * Use-case name inference from a single requirement sentence
 * -------------------------------------------------------------- */

function useCaseNameFromRequirement(text) {
  // 1) Explicit quoted name: "RegisterAccount" or «RegisterAccount»
  const quoted = text.match(/"([^"]{3,60})"|«([^»]{3,60})»/);
  if (quoted) {
    const name = (quoted[1] || quoted[2]).trim();
    if (/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return name;
    return name.replace(/\s+/g, '').replace(/^[a-z]/, (c) => c.toUpperCase());
  }

  // 2) Derive from the modal verb
  let phrase = text;
  const modal = phrase.match(/\b(?:shall|must|should|will)\s+(.+)$/i);
  if (modal) phrase = modal[1];

  phrase = phrase.split(/[.;:]/)[0].trim();
  phrase = phrase.replace(/^(allow|let|permit|enable)\s+/i, '');
  phrase = phrase.replace(/^(the\s+)?(system|application|software|platform)\s+/i, '');
  phrase = phrase.replace(/^(users?|actors?)\s+to\s+/i, '');
  phrase = phrase.replace(/^(a|an|the)\s+/i, '');
  phrase = phrase.replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim();

  const words = phrase.split(' ').filter(Boolean).slice(0, 8).join(' ');
  if (!words || words.length < 3) return null;
  return titleCase(words);
}

/* -------------------------------------------------------------- *
 * Bold-entity extraction: "- **Book**: description"
 * -------------------------------------------------------------- */

function extractBoldEntities(text) {
  const names = new Set();
  const re = /[-*]\s+\*\*([A-Z][\w ]{1,40}?)\*\*/g;
  let m;
  while ((m = re.exec(text))) names.add(m[1].trim());
  return [...names];
}

/* -------------------------------------------------------------- *
 * Frequency-based class fallback (used when no bold entities)
 * -------------------------------------------------------------- */

function extractClassesFromText(text) {
  const words = String(text).toLowerCase().match(/[a-z][a-z-]{3,}/g) || [];
  const counts = new Map();
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => ({
      name: titleCase(word),
      attributes: [{ name: 'id', type: 'String' }],
      methods: [],
      sourceRequirementCodes: []
    }));
}

/* -------------------------------------------------------------- *
 * Parse the "6.1 Entities" table for real attributes
 * -------------------------------------------------------------- */

function extractEntityAttributes(srsText) {
  const map = new Map();
  const text = String(srsText || '');

  // Locate the entities section (from "### 6.1 Entities" up to the next ## or ###)
  const sectionMatch = text.match(/###\s*6\.1\s+Entities[\s\S]*?(?=\n###|\n##|$)/);
  const scope = sectionMatch ? sectionMatch[0] : text;

  // Match rows like: | **Book** | description | id: String, title: String, author: String |
  const rowRe = /\|\s*\*\*([^*|\n]+?)\*\*\s*\|[^|\n]*\|\s*([^|\n]+?)\s*\|/g;
  let m;
  while ((m = rowRe.exec(scope))) {
    const name = m[1].trim();
    const attrsStr = m[2].trim();

    const attrs = attrsStr
      .split(',')
      .map((piece) => {
        const [attrName, attrType] = piece.split(':').map((x) => (x || '').trim());
        return attrName ? { name: attrName, type: attrType || 'String' } : null;
      })
      .filter(Boolean);

    if (attrs.length) map.set(name, attrs);
  }

  return map;
}

/* ============================================================= *
 * PUBLIC — mockExtract
 * ============================================================= */

export function mockExtract(requirements, rawSrsText = '') {
  const fullText = rawSrsText || requirements.map((r) => r.text).join('\n');

  /* ---------- Actors ---------- */

  const boldEntities = extractBoldEntities(fullText);

  const boldActors = boldEntities.filter((name) =>
    ACTOR_HINTS.some((hint) => name.toLowerCase().includes(hint))
  );

  const actors = [];

  if (boldActors.length > 0) {
    for (const name of boldActors.slice(0, 6)) {
      actors.push({ name, description: `Role "${name}"`, sourceRequirementCodes: [] });
    }
  } else {
    for (const hint of ACTOR_HINTS) {
      if (new RegExp(`\\b${hint}s?\\b`, 'i').test(fullText)) {
        actors.push({
          name: titleCase(hint),
          description: `Detected role "${hint}" in the SRS`,
          sourceRequirementCodes: []
        });
      }
      if (actors.length >= 6) break;
    }
  }

  if (actors.length === 0) {
    actors.push({ name: 'User', description: 'Default actor', sourceRequirementCodes: [] });
  }

  const primaryActor = actors[0].name;

  /* ---------- Use cases ---------- */

  const useCases = [];
  const seenUseCases = new Set();

  for (const requirement of requirements) {
    if (requirement.type === 'non-functional' || requirement.type === 'constraint') continue;
    const name = useCaseNameFromRequirement(requirement.text);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenUseCases.has(key)) continue;
    seenUseCases.add(key);
    useCases.push({
      name,
      actors: [primaryActor],
      includes: [],
      extends: [],
      description: requirement.text.slice(0, 240),
      sourceRequirementCodes: [requirement.code]
    });
    if (useCases.length >= 12) break;
  }

  /* ---------- Classes (with real attributes when available) ---------- */

  const attrMap = extractEntityAttributes(fullText);

  const classes =
    boldEntities.length > 0
      ? boldEntities.slice(0, 10).map((name) => ({
          name,
          attributes: attrMap.get(name) || [{ name: 'id', type: 'String' }],
          methods: [],
          sourceRequirementCodes: []
        }))
      : extractClassesFromText(fullText);

  if (classes.length === 0) {
    classes.push({
      name: 'Entity',
      attributes: [{ name: 'id', type: 'String' }],
      methods: [],
      sourceRequirementCodes: []
    });
  }

  /* ---------- Relationships (simple adjacency chain) ---------- */

  const relationships = [];
  for (let i = 0; i + 1 < classes.length; i += 1) {
    relationships.push({
      source: classes[i].name,
      target: classes[i + 1].name,
      type: 'association',
      multiplicity: '1..*'
    });
  }

  /* ---------- Gherkin test hints ---------- */

  const tests = useCases.map((useCase) => ({
    useCase: useCase.name,
    title: `${useCase.name} succeeds`,
    given: ['the user is authenticated and has the required permissions'],
    when: `the user performs "${useCase.name}"`,
    then: [`the system completes "${useCase.name}" successfully`],
    sourceRequirementCodes: useCase.sourceRequirementCodes
  }));

  return { actors, useCases, classes, relationships, tests };
}