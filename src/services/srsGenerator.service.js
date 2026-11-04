import { env } from '../config/env.js';
import { callLLM } from './llm/adapter.js';

/* ============================================================= *
 * DOMAIN KNOWLEDGE BASE (fallback richness when answers are thin)
 * ============================================================= */

const DOMAINS = [
  {
    keys: ['library', 'book', 'catalog'],
    topic: 'library management',
    domain: 'Library',
    actors: ['Member', 'Librarian', 'Administrator'],
    entities: ['Book', 'Member', 'Loan', 'Fine', 'Category'],
    useCases: ['SearchCatalog', 'BorrowBook', 'ReturnBook', 'PayFine', 'ManageInventory', 'RegisterMember']
  },
  {
    keys: ['shop', 'store', 'ecommerce', 'purchase', 'cart', 'market'],
    topic: 'online shopping',
    domain: 'Shop',
    actors: ['Customer', 'Seller', 'Administrator'],
    entities: ['Product', 'Cart', 'Order', 'Customer', 'Payment'],
    useCases: ['BrowseProducts', 'AddToCart', 'CheckoutOrder', 'TrackOrder', 'ManageCatalog', 'ProcessPayment']
  },
  {
    keys: ['bank', 'finance', 'wallet'],
    topic: 'banking',
    domain: 'Banking',
    actors: ['Customer', 'Teller', 'Administrator'],
    entities: ['Account', 'Transaction', 'Customer', 'Card', 'Transfer'],
    useCases: ['OpenAccount', 'TransferFunds', 'ViewStatement', 'PayBill', 'ManageCards', 'ReviewTransactions']
  },
  {
    keys: ['hospital', 'patient', 'medical', 'doctor', 'clinic', 'health'],
    topic: 'healthcare',
    domain: 'Clinic',
    actors: ['Patient', 'Doctor', 'Administrator'],
    entities: ['Patient', 'Appointment', 'Doctor', 'Prescription', 'Record'],
    useCases: ['BookAppointment', 'ViewRecords', 'PrescribeMedication', 'ManageSchedule', 'RegisterPatient', 'SendReminder']
  },
  {
    keys: ['task', 'todo', 'kanban', 'project'],
    topic: 'task management',
    domain: 'Task',
    actors: ['Member', 'Manager', 'Administrator'],
    entities: ['Task', 'Board', 'Column', 'User', 'Comment'],
    useCases: ['CreateTask', 'AssignTask', 'MoveTask', 'CommentTask', 'ViewBoard', 'ManageMembers']
  },
  {
    keys: ['blog', 'news', 'post', 'content'],
    topic: 'blogging',
    domain: 'Blog',
    actors: ['Author', 'Reader', 'Administrator'],
    entities: ['Article', 'Comment', 'Category', 'Author', 'Tag'],
    useCases: ['CreateArticle', 'PublishArticle', 'CommentArticle', 'BrowseArticles', 'ModerateComments', 'ManageCategories']
  },
  {
    keys: ['school', 'student', 'course', 'learn', 'education', 'lms'],
    topic: 'learning management',
    domain: 'Learning',
    actors: ['Student', 'Instructor', 'Administrator'],
    entities: ['Course', 'Student', 'Enrollment', 'Assignment', 'Grade'],
    useCases: ['EnrollCourse', 'SubmitAssignment', 'GradeSubmission', 'ViewCourse', 'ManageCourses', 'IssueCertificate']
  },
  {
    keys: ['event', 'booking', 'ticket'],
    topic: 'event management',
    domain: 'Event',
    actors: ['Attendee', 'Organizer', 'Administrator'],
    entities: ['Event', 'Ticket', 'Venue', 'Attendee', 'Booking'],
    useCases: ['CreateEvent', 'BookTicket', 'CancelBooking', 'CheckInAttendee', 'ManageVenue', 'PublishEvent']
  },
  {
    keys: ['hotel', 'reservation', 'room', 'guest'],
    topic: 'hotel reservation',
    domain: 'Hotel',
    actors: ['Guest', 'Receptionist', 'Administrator'],
    entities: ['Room', 'Booking', 'Guest', 'Invoice', 'Service'],
    useCases: ['SearchRooms', 'BookRoom', 'CheckIn', 'CheckOut', 'ManageRooms', 'GenerateInvoice']
  },
  {
    keys: ['chat', 'message', 'messaging'],
    topic: 'messaging',
    domain: 'Chat',
    actors: ['User', 'Moderator', 'Administrator'],
    entities: ['Message', 'Conversation', 'Room', 'User', 'Attachment'],
    useCases: ['SendMessage', 'CreateRoom', 'JoinRoom', 'ViewHistory', 'ShareAttachment', 'ModerateContent']
  }
];

const FALLBACK = {
  topic: 'web application',
  domain: 'System',
  actors: ['User', 'Administrator'],
  entities: ['User', 'Item', 'Account', 'Record'],
  useCases: ['RegisterAccount', 'Login', 'ViewDashboard', 'ManageProfile', 'SearchItems', 'GenerateReport']
};

function pickDomain(projectName) {
  const lower = String(projectName || '').toLowerCase();
  for (const d of DOMAINS) {
    if (d.keys.some((k) => lower.includes(k))) return d;
  }
  return FALLBACK;
}

/* ============================================================= *
 * HELPERS
 * ============================================================= */

const pad = (n) => String(n).padStart(2, '0');

function titleCase(s) {
  return String(s || '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function featureToUseCase(feature) {
  let phrase = String(feature || '').trim();
  phrase = phrase.replace(/^(users?|customers?|admins?|members?|patients?)\s+(can|shall|may)\s+/i, '');
  phrase = phrase.replace(/^(the\s+)?system\s+(shall|must|will)\s+/i, '');
  phrase = phrase.replace(/^(allow|let|permit|enable)\s+/i, '');
  phrase = phrase.replace(/^(to\s+)/i, '');
  phrase = phrase.replace(/[.;:]/g, '').trim();
  const name = titleCase(phrase).slice(0, 40);
  return name || 'PerformAction';
}

function featureToFr(feature, actor) {
  const cleaned = String(feature || '').replace(/[.;]+$/, '').trim();
  if (!cleaned) return '';
  if (/^(the\s+)?system\s+(shall|must|will)/i.test(cleaned)) return cleaned;
  return `The system shall allow the ${actor} to ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}.`;
}

/* Advancement catalogue — each label maps to a requirement + test hint */
const ADVANCEMENT_CATALOG = {
  ai: {
    label: 'AI / LLM integration',
    fr: 'The system shall integrate a large language model to provide intelligent assistance within the application.',
    nfr: 'AI responses shall return within 10 seconds under normal conditions.',
    test: 'the user requests AI assistance and the system returns a valid generated response'
  },
  realtime: {
    label: 'Real-time updates (WebSockets / SSE)',
    fr: 'The system shall push updates to connected clients in real time using WebSockets or server-sent events.',
    nfr: 'Real-time updates shall reach the client within 500 ms of the underlying event.',
    test: 'an underlying data change occurs and the client receives the update over the real-time channel'
  },
  analytics: {
    label: 'Analytics dashboard',
    fr: 'The system shall present an analytics dashboard with aggregate metrics and time-series charts.',
    nfr: 'Analytics dashboards shall render in under 2 seconds for datasets up to 100,000 records.',
    test: 'the user opens the analytics dashboard and the charts display the correct aggregates'
  },
  i18n: {
    label: 'Multi-language (i18n)',
    fr: 'The system shall support multiple languages and allow users to switch the interface language at any time.',
    nfr: 'Language switching shall not require a page reload and shall take effect within 200 ms.',
    test: 'the user switches the language and the interface updates without reloading'
  },
  mobile: {
    label: 'Mobile application',
    fr: 'The system shall expose a mobile-friendly responsive interface for use on phones and tablets.',
    nfr: 'All primary workflows shall be usable on screens as narrow as 360 px.',
    test: 'the user completes the primary workflow on a 360 px viewport'
  },
  payments: {
    label: 'Payment integration',
    fr: 'The system shall integrate a payment gateway for secure online transactions.',
    nfr: 'Payment requests shall complete within 5 seconds and shall never store raw card data.',
    test: 'the user submits a payment and the gateway returns a successful charge'
  },
  rbac: {
    label: 'Role-based access control (RBAC)',
    fr: 'The system shall enforce role-based access control so each user sees only what their role permits.',
    nfr: 'Authorization checks shall run on every API request with sub-10 ms overhead.',
    test: 'a user without the required role attempts an action and receives a 403 error'
  },
  audit: {
    label: 'Audit logging',
    fr: 'The system shall record an immutable audit log of logins, data mutations, exports and deletions.',
    nfr: 'Audit log entries shall be queryable within 5 seconds of the underlying event.',
    test: 'a sensitive action is performed and a matching audit log entry appears'
  },
  search: {
    label: 'Advanced search',
    fr: 'The system shall provide full-text search with filters, sorting and pagination across primary records.',
    nfr: 'Search results shall be returned within 1 second for datasets up to 100,000 records.',
    test: 'the user submits a search query and the results page loads with the correct filters applied'
  },
  notifications: {
    label: 'Notifications (email / SMS)',
    fr: 'The system shall send email and SMS notifications for key events such as account activity and reminders.',
    nfr: 'Notification deliveries shall be attempted within 60 seconds of the triggering event.',
    test: 'a triggering event occurs and the user receives an email or SMS notification'
  }
};

/* ============================================================= *
 * BUILD SRS FROM ANSWERS
 * ============================================================= */

function buildFromAnswers(projectName, answers = {}) {
  const domain = pickDomain(projectName);

  // 1. Actors — user's actors win, domain actors fill in
  const userActors = (answers.actors || []).map((a) => String(a).trim()).filter(Boolean);
  const actors = userActors.length ? userActors : domain.actors;
  const primaryActor = actors[0] || 'User';

  // 2. Features → use cases + FRs
  const userFeatures = (answers.features || []).map((f) => String(f).trim()).filter(Boolean);
  const useCases = (userFeatures.length ? userFeatures : domain.useCases).map((f) => ({
    name: userFeatures.length ? featureToUseCase(f) : f,
    description: userFeatures.length ? f : `${f.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}.`,
    actor: primaryActor
  }));

  // 3. Functional requirements
  const functional = [];
  let frCounter = 1;
  for (const uc of useCases) {
    functional.push(`FR-${pad(frCounter++)}: The system shall allow the ${uc.actor} to perform "${uc.name}".`);
  }
  for (const uc of useCases) {
    functional.push(`FR-${pad(frCounter++)}: ${featureToFr(uc.description, uc.actor)}`);
  }
  // boilerplate
  const extra = [
    'The system shall authenticate users before granting access.',
    'The system shall allow users to reset their password by email.',
    `The system shall be deployed using ${answers.deployment || 'Docker'}.`,
    `The system shall persist data in ${answers.database || 'MongoDB'}.`
  ];
  for (const text of extra) functional.push(`FR-${pad(frCounter++)}: ${text}`);

  // 4. Advancements section
  const advanceSelected = (answers.advancements || []).filter((k) => ADVANCEMENT_CATALOG[k]);
  const advanceSections = advanceSelected.map((k) => {
    const a = ADVANCEMENT_CATALOG[k];
    return `### ${a.label}\n${a.fr}`;
  });
  const advanceFRs = advanceSelected.map((k) => {
    const a = ADVANCEMENT_CATALOG[k];
    return `FR-${pad(frCounter++)}: ${a.fr}`;
  });
  functional.push(...advanceFRs);

  // 5. NFRs grouped, boosted by user priorities
  const priorities = new Set(answers.nfrPriorities || []);
  const nfrSections = {
    Performance: [
      ...(priorities.has('performance')
        ? [
            'The system shall respond to standard UI actions within 300 ms.',
            'The system shall support at least 200 concurrent users.'
          ]
        : ['The system shall respond to standard UI actions within 500 ms.']),
      ...advanceSelected
        .map((k) => ADVANCEMENT_CATALOG[k]?.nfr)
        .filter((x) => x && /performance|response|render|within \d/i.test(x))
    ],
    Security: [
      'The system shall hash passwords with bcrypt or Argon2.',
      'The system shall serve traffic over HTTPS with TLS 1.2 or higher.',
      ...(priorities.has('security')
        ? [
            'The system shall protect against the OWASP Top 10 including injection, XSS and CSRF.',
            'API keys shall be stored in environment secrets, never in source code.'
          ]
        : [])
    ],
    Usability: [
      'A new user shall complete their first primary task within 10 minutes without training.',
      'The interface shall meet WCAG 2.1 level AA for all core workflows.'
    ],
    Scalability: priorities.has('scalability')
      ? [
          'The system shall scale horizontally behind a load balancer.',
          'The system shall support the target load of ' +
            (answers.scale === 'large' ? '10,000' : answers.scale === 'small' ? '100' : '1,000') +
            ' concurrent users.'
        ]
      : ['The system shall support a moderate increase in load without architecture changes.'],
    Reliability: [
      'The system shall target 99% availability during evaluation and demonstration.',
      'The system shall preserve user edits with autosave every 30 seconds.'
    ],
    Compliance: [
      'The system shall process all user data in line with GDPR.',
      'The system shall support user data export and deletion on request.'
    ]
  };
  let nfrCounter = 1;
  const nfrLines = [];
  for (const [category, items] of Object.entries(nfrSections)) {
    nfrLines.push(`\n#### ${category}`);
    for (const text of items) nfrLines.push(`- NFR-${pad(nfrCounter++)}: ${text}`);
  }

  // 6. Data requirements — from domain + a couple of generic
  const entityTable = domain.entities
    .map((e) => `| **${e}** | Core domain object. | id: String, name: String, createdAt: Date |`)
    .join('\n');

  // 7. Traceability — one row per use case
  const traceRows = useCases
    .map((uc, i) => `| FR-${pad(i + 1)} | ${uc.name} | TC-${pad(i + 1)} |`)
    .join('\n');

  // 8. Assemble
  const briefLine = answers.brief || answers.goal ? `\n> **Project brief:** ${answers.brief || answers.goal}\n` : '';

  return `# Software Requirements Specification: ${projectName}
${briefLine}
**Document standard:** IEEE 830 / ISO-IEC-IEEE 29148
**Version:** 1.0
**Status:** Draft

---

## 1. Introduction

### 1.1 Purpose
This document specifies the complete functional and non-functional requirements for **${projectName}**, a ${domain.topic} system${answers.goal ? ` whose goal is to ${String(answers.goal).replace(/^to\s+/i, '')}` : ''}.

### 1.2 Document Conventions
- **FR-NN** — functional requirement
- **NFR-NN** — non-functional requirement
- **UC-NN** — use case
- The keyword **shall** denotes a mandatory requirement.

### 1.3 Intended Audience
- Requirements analysts and product owners
- Software architects and developers
- QA engineers and testers
- Project managers and supervisors
- Academic reviewers (thesis committee)

### 1.4 Product Scope
${projectName} is a ${domain.topic} web application built on the **${answers.stack || 'MERN'}** stack, deployed via **${answers.deployment || 'Docker'}**, persisting to **${answers.database || 'MongoDB'}**. Target scale: **${answers.scale || 'medium'}**.

### 1.5 References
- ISO/IEC/IEEE 29148:2018 — Requirements engineering
- IEEE 830-1998 — Recommended practice for SRS
- OMG UML 2.5.1 specification
- GDPR (Regulation EU 2016/679)

---

## 2. Overall Description

### 2.1 Product Perspective
${projectName} is a standalone web application with a React front end, a Node.js/Express back end and a ${answers.database || 'MongoDB'} database. It integrates with an LLM API for intelligent assistance.

### 2.2 Product Functions
${useCases.map((uc) => `- **${uc.name}** — ${uc.description}`).join('\n')}

### 2.3 User Classes and Characteristics
| Role | Description | Technical Level |
|------|-------------|-----------------|
${actors.map((a) => `| ${a} | Interacts with the system to perform role-specific operations. | ${a.toLowerCase().includes('admin') ? 'High' : 'Low'} |`).join('\n')}

### 2.4 Operating Environment
- **Client:** Latest two versions of Chrome, Firefox, Edge, Safari
- **Server:** Linux (Docker containers), Node.js 18+, ${answers.database || 'MongoDB'}
- **External services:** One or more LLM providers and payment/notification gateways as configured

### 2.5 Design and Implementation Constraints
- The system shall be implemented with **${answers.stack || 'MERN'}**.
- The system shall use **${answers.database || 'MongoDB'}** as the primary data store.
- The system shall be deployed via **${answers.deployment || 'Docker'}**.
- Diagram output shall be representable as PlantUML text.
- Uploaded documents shall be processed in line with GDPR principles.
${answers.extraNotes ? `- Additional notes from the requester: ${answers.extraNotes}\n` : ''}

### 2.6 Assumptions and Dependencies
- Users have access to a modern web browser.
- The LLM provider will be available throughout the project duration.
- Network latency between the client and server will stay under 200 ms on average.

---

## 3. System Features

${useCases
  .map(
    (uc, i) => `### 3.${i + 1} ${uc.name}
**Primary actor:** ${uc.actor}
**Priority:** High
**Description:** ${uc.description}

**Stimulus/Response:**
- *Stimulus:* ${uc.actor} requests "${uc.name}".
- *Response:* System validates the request, executes the operation and returns confirmation.
`
  )
  .join('\n')}
${advanceSections.length ? `\n### 3.${useCases.length + 1} Advanced Features\n\n${advanceSections.join('\n\n')}\n` : ''}

### Functional Requirements (consolidated)
${functional.map((r) => `- ${r}`).join('\n')}

---

## 4. External Interface Requirements

### 4.1 User Interfaces
- UI-1: Responsive web interface from 1280 px desktop down to tablet width.
- UI-2: Split-pane workspace showing data and rendered diagrams side by side.
- UI-3: Keyboard navigation and screen-reader labels for all primary actions.
- UI-4: Light and dark themes.

### 4.2 Software Interfaces
| Interface | Purpose |
|-----------|---------|
| LLM provider API | Content generation and extraction |
| ${answers.database || 'MongoDB'} | Persistent data storage |
| PlantUML renderer | Convert PlantUML text to SVG/PNG |
| Email service (SMTP) | Verification and password reset |

### 4.3 Communication Interfaces
- HTTPS (TLS 1.2 or higher) for all client-server traffic.
- JSON over REST between front end and back end.
- Server-sent events for streaming progress where applicable.

---

## 5. Non-Functional Requirements
${nfrLines.join('\n')}

---

## 6. Data Requirements

### 6.1 Entities
| Entity | Description | Key Attributes |
|--------|-------------|----------------|
${entityTable}

### 6.2 Business Rules
- All destructive actions are logged.
- Access to records is enforced by role.

### 6.3 Data Retention
- User data is retained only as long as needed for operational and legal reasons.
- Users can request export and deletion at any time (GDPR rights).

---

## 7. Traceability Matrix

| Requirement | Use Case | Test |
|-------------|----------|------|
${traceRows}

---

## 8. Appendices

### 8.1 Glossary
- **SRS**: Software Requirements Specification
- **UML**: Unified Modeling Language
- **Gherkin**: Given/When/Then syntax
- **RBAC**: Role-Based Access Control

### 8.2 Open Questions
- Which LLM providers will be used for the final experiments?
- Will the dataset be released publicly, and under what license?
- What supervisor and ethics process apply to the user study?
`;
}

/* ============================================================= *
 * LLM PROMPT — richer prompt that includes answers
 * ============================================================= */

const SRS_SYSTEM_PROMPT = `You are an expert requirements engineer writing an IEEE-830 / ISO 29148 compliant SRS.
You will receive a project name and a JSON object of user answers (actors, goal, features,
stack, database, deployment, scale, advancements, nfrPriorities).

Structure the output exactly like this:
# Software Requirements Specification: <ProjectName>
## 1. Introduction (Purpose, Conventions, Audience, Scope, References)
## 2. Overall Description (Perspective, Functions, User Classes table, Environment, Constraints, Assumptions)
## 3. System Features (one block per use case, then consolidated FR list with FR-NN: prefixes)
## 4. External Interface Requirements
## 5. Non-Functional Requirements (grouped: Performance, Security, Usability, Scalability, Reliability, Compliance)
## 6. Data Requirements (Entity table, Business Rules, Retention)
## 7. Traceability Matrix
## 8. Appendices (Glossary, Open Questions)

Rules:
- Treat the user's \`actors\` and \`features\` as the source of truth. Bold actor and entity names.
- Reference use case names in FRs with quotes: FR-01: The system shall allow the <Actor> to perform "SomeUseCase".
- For every item in \`advancements\`, add a dedicated sub-section under "3.x Advanced Features" with its own FR.
- Put \`stack\`, \`database\` and \`deployment\` into the Constraints section.
- Boost NFR categories the user listed in \`nfrPriorities\`.
- Every FR must be prefixed with FR-NN: and every NFR with NFR-NN: (zero-padded).
- Return ONLY the Markdown. No code fences. No commentary.`;

/* ============================================================= *
 * PUBLIC API
 * ============================================================= */

export async function generateSrs(projectName, brief = '', answers = null) {
  const provider = (env.llm.provider || 'mock').toLowerCase();
  const hasKey = Boolean(env.llm.apiKey);

  // ---------- LLM path ----------
  if (provider !== 'mock' && hasKey) {
    try {
      const payload = {
        projectName,
        brief,
        ...(answers || {})
      };
      const userPrompt = `Project context (JSON):\n${JSON.stringify(payload, null, 2)}\n\nGenerate the SRS now.`;
      const llm = await callLLM({
        system: SRS_SYSTEM_PROMPT,
        user: userPrompt,
        jsonMode: false
      });
      const text = String(llm.text || '').trim();
      if (text.length > 500) return text;
      throw new Error('LLM returned a short SRS');
    } catch (err) {
      console.warn('[srsGenerator] LLM failed, using template:', err.message);
    }
  }

  // ---------- Template path ----------
  return buildFromAnswers(projectName, { ...(answers || {}), brief });
}