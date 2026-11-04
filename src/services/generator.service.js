const quote = (value) => `"${String(value ?? '').replace(/"/g, "'").replace(/\s+/g, ' ').trim()}"`;

const sanitizeMember = (value) =>
  String(value ?? '')
    .replace(/[{}\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* ============================================================= *
 * EXISTING: use-case, class, gherkin
 * ============================================================= */

export function buildUseCasePlantUml({ actors = [], useCases = [] }) {
  const lines = ['@startuml', 'left to right direction', 'skinparam packageStyle rectangle'];

  const actorAlias = new Map();
  actors.forEach((actor, index) => {
    const alias = `A${index}`;
    actorAlias.set(String(actor.name).toLowerCase(), alias);
    lines.push(`actor ${quote(actor.name)} as ${alias}`);
  });

  const useCaseAlias = new Map();
  useCases.forEach((useCase, index) => {
    const alias = `UC${index}`;
    useCaseAlias.set(String(useCase.name).toLowerCase(), alias);
    lines.push(`usecase ${quote(useCase.name)} as ${alias}`);
  });

  const defaultActor = actors.length ? 'A0' : null;

  for (const useCase of useCases) {
    const to = useCaseAlias.get(String(useCase.name).toLowerCase());
    for (const actorName of useCase.actors || []) {
      const from = actorAlias.get(String(actorName).toLowerCase()) || defaultActor;
      if (from && to) lines.push(`${from} --> ${to}`);
    }
  }

  for (const useCase of useCases) {
    const from = useCaseAlias.get(String(useCase.name).toLowerCase());
    for (const target of useCase.includes || []) {
      const to = useCaseAlias.get(String(target).toLowerCase());
      if (from && to) lines.push(`${from} ..> ${to} : <<include>>`);
    }
    for (const target of useCase.extends || []) {
      const to = useCaseAlias.get(String(target).toLowerCase());
      if (from && to) lines.push(`${to} <.. ${from} : <<extend>>`);
    }
  }

  lines.push('@enduml');
  return lines.join('\n');
}

const ARROWS = { association: '--', aggregation: 'o--', composition: '*--', inheritance: '<|--' };

export function buildClassPlantUml({ classes = [], relationships = [] }) {
  const lines = ['@startuml', 'skinparam classAttributeIconSize 0'];
  const alias = new Map();

  classes.forEach((cls, index) => {
    const id = `C${index}`;
    alias.set(String(cls.name).toLowerCase(), id);
    lines.push(`class ${quote(cls.name)} as ${id} {`);
    for (const attr of cls.attributes || []) {
      lines.push(`  +${sanitizeMember(attr.name)}: ${sanitizeMember(attr.type || 'String')}`);
    }
    for (const method of cls.methods || []) {
      lines.push(`  +${sanitizeMember(method)}()`);
    }
    lines.push('}');
  });

  for (const rel of relationships || []) {
    const from = alias.get(String(rel.source).toLowerCase());
    const to = alias.get(String(rel.target).toLowerCase());
    if (!from || !to || from === to) continue;
    const arrow = ARROWS[rel.type] || ARROWS.association;
    const label = rel.multiplicity ? ` : ${sanitizeMember(rel.multiplicity)}` : '';
    lines.push(`${from} ${arrow} ${to}${label}`);
  }

  lines.push('@enduml');
  return lines.join('\n');
}

export function buildGherkin(test, index = 1) {
  const lines = [`Feature: ${test.useCase || 'Generated use case'}`, ''];

  if (test.sourceRequirementCodes?.length) {
    lines.push(`  # Requirements: ${test.sourceRequirementCodes.join(', ')}`);
  }
  lines.push(`  @scenario-${index}`);
  lines.push(`  Scenario: ${test.title || `Scenario ${index}`}`);

  (test.given || []).forEach((step, i) => lines.push(`    ${i === 0 ? 'Given' : 'And'} ${step}`));
  if (test.when) lines.push(`    When ${test.when}`);
  (test.then || []).forEach((step, i) => lines.push(`    ${i === 0 ? 'Then' : 'And'} ${step}`));

  return lines.join('\n');
}

/* ============================================================= *
 * NEW: sequence diagram (for the first use case)
 * ============================================================= */

export function buildSequencePlantUml(model = {}, useCaseName = '') {
  const useCases = model.useCases || [];
  const uc = useCases.find((u) => u.name === useCaseName) || useCases[0];
  if (!uc) return '@startuml\ntitle Sequence — no use cases\nautonumber\n"User" -> "System" : (empty)\n@enduml';

  const actor = (uc.actors || [])[0] || 'User';

  return [
    '@startuml',
    `title Sequence Diagram — ${uc.name}`,
    'autonumber',
    `actor ${quote(actor)} as User`,
    'participant "System" as System',
    'database "Database" as DB',
    '',
    `User -> System : ${uc.name}(input)`,
    'activate System',
    'System -> System : validate(input)',
    'alt valid input',
    `  System -> DB : persist(${uc.name})`,
    '  activate DB',
    '  DB --> System : ok',
    '  deactivate DB',
    '  System --> User : 200 success',
    'else invalid input',
    '  System --> User : 400 Bad Request',
    'end',
    'deactivate System',
    '@enduml'
  ].join('\n');
}

/* ============================================================= *
 * NEW: activity diagram (for the first use case)
 * ============================================================= */

export function buildActivityPlantUml(model = {}, useCaseName = '') {
  const useCases = model.useCases || [];
  const uc = useCases.find((u) => u.name === useCaseName) || useCases[0];
  if (!uc) return '@startuml\ntitle Activity — no use cases\nstart\n:Nothing to do;\nstop\n@enduml';

  const actor = (uc.actors || [])[0] || 'User';

  return [
    '@startuml',
    `title Activity Diagram — ${uc.name}`,
    'start',
    `:${actor} initiates ${uc.name};`,
    ':System validates input;',
    'if (Valid?) then (yes)',
    '  :Process request;',
    '  :Persist to database;',
    '  :Return success response;',
    'else (no)',
    '  :Return validation error;',
    'endif',
    'stop',
    '@enduml'
  ].join('\n');
}

/* ============================================================= *
 * NEW: state diagram (for the first class)
 * ============================================================= */

export function buildStatePlantUml(model = {}, className = '') {
  const classes = model.classes || [];
  const cls = classes.find((c) => c.name === className) || classes[0];
  if (!cls) return '@startuml\ntitle State — no classes\n[*] --> Idle\n@enduml';

  return [
    '@startuml',
    `title State Diagram — ${cls.name} lifecycle`,
    '[*] --> Created',
    'Created --> Active : activate',
    'Active --> Suspended : suspend',
    'Suspended --> Active : resume',
    'Active --> Archived : archive',
    'Archived --> [*]',
    'note right of Suspended : temporary\nhold state',
    '@enduml'
  ].join('\n');
}

/* ============================================================= *
 * NEW: ER diagram (all classes + relationships)
 * ============================================================= */

const CARDINALITY = {
  '1..*': '||--o{',
  '*..1': '}o--||',
  '1..1': '||--||',
  '0..1': '||--o|',
  '1': '||--||',
  '*': '}o--o{'
};

export function buildErPlantUml(model = {}) {
  const classes = model.classes || [];
  const relationships = model.relationships || [];

  if (classes.length === 0) return '@startuml\ntitle ER Diagram\nentity "Empty" as E\n@enduml';

  const lines = ['@startuml', 'title Entity-Relationship Diagram', 'hide circle'];

  for (const cls of classes) {
    const alias = sanitizeMember(cls.name);
    lines.push(`entity ${quote(cls.name)} as ${alias} {`);
    const attrs = cls.attributes || [];
    for (let i = 0; i < attrs.length; i += 1) {
      const a = attrs[i];
      const prefix = i === 0 ? '  *' : '  ';
      lines.push(`${prefix}${sanitizeMember(a.name)} : ${sanitizeMember(a.type || 'String')}`);
    }
    lines.push('}');
  }

  const known = new Set(classes.map((c) => sanitizeMember(c.name)));

  for (const rel of relationships) {
    const from = sanitizeMember(rel.source);
    const to = sanitizeMember(rel.target);
    if (!known.has(from) || !known.has(to) || from === to) continue;
    const notation = CARDINALITY[rel.multiplicity] || '||--o{';
    const label = rel.multiplicity ? ` : ${sanitizeMember(rel.multiplicity)}` : '';
    lines.push(`${from} ${notation} ${to}${label}`);
  }

  lines.push('@enduml');
  return lines.join('\n');
}

/* ============================================================= *
 * NEW: unit-test skeletons (Jest / Mocha style)
 * ============================================================= */

export function buildUnitTestSkeletons(model = {}) {
  const classes = model.classes || [];
  const results = [];

  for (const cls of classes) {
    const attrs = cls.attributes || [];
    const sampleFields = attrs.map((a) => `${a.name}: 'sample'`).join(', ');

    const lines = [
      `// Unit test skeleton for "${cls.name}"`,
      `// Generated by SpecForge. Adjust the import path and assertions to match your model.`,
      `// const ${cls.name} = require('../models/${cls.name}');`,
      ``,
      `describe('${cls.name}', () => {`
    ];

    for (const attr of attrs) {
      lines.push(
        `  test('has a "${attr.name}" field of type ${attr.type || 'String'}', () => {`,
        `    // expect(${cls.name}.schema.paths['${attr.name}']).toBeDefined();`,
        `    expect(true).toBe(true); // TODO: replace`,
        `  });`,
        ``
      );
    }

    lines.push(
      `  test('creates an instance with valid input', () => {`,
      `    const attrs = { ${sampleFields} };`,
      `    // const instance = new ${cls.name}(attrs);`,
      `    // expect(instance).toBeDefined();`,
      `    expect(Object.keys(attrs).length).toBeGreaterThan(0); // TODO`,
      `  });`,
      `});`
    );

    results.push({
      testType: 'unit',
      targetClass: cls.name,
      title: `Unit tests — ${cls.name}`,
      language: 'javascript',
      code: lines.join('\n')
    });
  }

  return results;
}

/* ============================================================= *
 * NEW: API-test skeletons (Supertest)
 * ============================================================= */

const endpointFromName = (name) =>
  '/' +
  String(name || 'action')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();

export function buildApiTestSkeletons(model = {}) {
  const useCases = model.useCases || [];
  const results = [];

  for (const uc of useCases) {
    const endpoint = endpointFromName(uc.name);

    const lines = [
      `// API test skeleton for use case "${uc.name}"`,
      `// Generated by SpecForge. Adjust the body and assertions to match your API.`,
      `// const request = require('supertest');`,
      `// const app = require('../app');`,
      ``,
      `describe('API: ${uc.name}', () => {`,
      `  test('POST ${endpoint} returns 200 with valid input', async () => {`,
      `    // const res = await request(app)`,
      `    //   .post('${endpoint}')`,
      `    //   .set('Authorization', 'Bearer <token>')`,
      `    //   .send({ /* TODO: request body */ });`,
      `    // expect(res.status).toBe(200);`,
      `    expect(true).toBe(true); // TODO: replace`,
      `  });`,
      ``,
      `  test('POST ${endpoint} returns 400 with invalid input', async () => {`,
      `    // const res = await request(app)`,
      `    //   .post('${endpoint}')`,
      `    //   .send({});`,
      `    // expect(res.status).toBe(400);`,
      `    expect(true).toBe(true); // TODO: replace`,
      `  });`,
      ``,
      `  test('POST ${endpoint} returns 401 without auth', async () => {`,
      `    // const res = await request(app).post('${endpoint}').send({});`,
      `    // expect(res.status).toBe(401);`,
      `    expect(true).toBe(true); // TODO: replace`,
      `  });`,
      `});`
    ];

    results.push({
      testType: 'api',
      useCase: uc.name,
      endpoint,
      method: 'POST',
      title: `API tests — ${uc.name}`,
      language: 'javascript',
      code: lines.join('\n'),
      sourceRequirementCodes: uc.sourceRequirementCodes || []
    });
  }

  return results;
}

/* ============================================================= *
 * NEW: Jira CSV export (import via Jira's CSV importer)
 * ============================================================= */

const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

export function buildJiraCsv({ projectName, requirements = [], model = {}, tests = [] }) {
  const useCaseByReq = new Map();
  for (const uc of model.useCases || []) {
    for (const code of uc.sourceRequirementCodes || []) {
      if (!useCaseByReq.has(code)) useCaseByReq.set(code, []);
      useCaseByReq.get(code).push(uc.name);
    }
  }

  const testByReq = new Map();
  for (const t of tests || []) {
    for (const code of t.sourceRequirementCodes || []) {
      if (!testByReq.has(code)) testByReq.set(code, []);
      testByReq.get(code).push(t.title || t.useCase || 'test');
    }
  }

  const rows = [['Summary', 'Issue Type', 'Priority', 'Description', 'Labels'].join(',')];

  for (const req of requirements) {
    const ucs = useCaseByReq.get(req.code) || [];
    const ts = testByReq.get(req.code) || [];

    const summary = `[${projectName}] ${req.code}: ${req.text.slice(0, 60)}${
      req.text.length > 60 ? '…' : ''
    }`;

    const desc = [
      req.text,
      '',
      `Requirement: ${req.code}`,
      `Use cases: ${ucs.join(', ') || '—'}`,
      `Tests: ${ts.join(', ') || '—'}`
    ].join('\n');

    const priority = req.type === 'non-functional' ? 'Medium' : 'High';
    const labels = [
      'requirement',
      req.code.toLowerCase(),
      projectName.toLowerCase().replace(/\s+/g, '-')
    ].join(' ');

    rows.push(
      [csvEscape(summary), 'Story', priority, csvEscape(desc), csvEscape(labels)].join(',')
    );
  }

  return rows.join('\n');
}

/* ============================================================= *
 * NEW: GitHub Issues markdown export (copy-paste or script)
 * ============================================================= */

export function buildGithubIssuesMarkdown({ projectName, requirements = [], model = {}, tests = [] }) {
  const lines = [
    `# ${projectName} — GitHub Issues`,
    '',
    'Generated by SpecForge. Copy each section below into a GitHub issue.',
    'Tip: use `gh issue create --title "<title>" --body "<body>"` to script the import.',
    ''
  ];

  const useCaseByReq = new Map();
  for (const uc of model.useCases || []) {
    for (const code of uc.sourceRequirementCodes || []) {
      if (!useCaseByReq.has(code)) useCaseByReq.set(code, []);
      useCaseByReq.get(code).push(uc.name);
    }
  }

  const testByReq = new Map();
  for (const t of tests || []) {
    for (const code of t.sourceRequirementCodes || []) {
      if (!testByReq.has(code)) testByReq.set(code, []);
      testByReq.get(code).push(t.title || t.useCase || 'test');
    }
  }

  for (const req of requirements) {
    const ucs = useCaseByReq.get(req.code) || [];
    const ts = testByReq.get(req.code) || [];
    const title = `${req.code}: ${req.text.slice(0, 80)}${req.text.length > 80 ? '…' : ''}`;

    lines.push('---', '');
    lines.push(`## ${title}`);
    lines.push('');
    lines.push(`**Labels:** \`requirement\`, \`${req.code.toLowerCase()}\``);
    lines.push(`**Priority:** ${req.type === 'non-functional' ? 'Medium' : 'High'}`);
    lines.push('');
    lines.push('### Description');
    lines.push('');
    lines.push(req.text);
    lines.push('');
    if (ucs.length) {
      lines.push('### Linked use cases');
      lines.push('');
      for (const uc of ucs) lines.push(`- ${uc}`);
      lines.push('');
    }
    if (ts.length) {
      lines.push('### Linked tests');
      lines.push('');
      for (const t of ts) lines.push(`- ${t}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}