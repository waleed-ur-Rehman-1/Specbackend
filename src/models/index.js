import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['analyst', 'developer', 'researcher', 'admin'],
      default: 'analyst'
    }
  },
  { timestamps: true }
);

const ProjectSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },

    // --- auto-generation pipeline ---
    brief: { type: String, default: '' },
      answers: { type: Schema.Types.Mixed, default: null },
    genStatus: { type: String, enum: ['draft', 'running', 'done', 'failed'], default: 'draft' },
    genStage: {
      type: String,
      enum: ['idle', 'srs', 'parse', 'extract', 'tests', 'done'],
      default: 'idle'
    },
    genError: { type: String, default: '' },
    latestDocumentId: { type: Schema.Types.ObjectId, ref: 'SrsDocument', default: null }
  },
  { timestamps: true }
);

const SrsDocumentSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    fileName: { type: String, default: 'pasted.txt' },
    mimeType: { type: String, default: 'text/plain' },
    sizeBytes: { type: Number, default: 0 },
    extractedText: { type: String, required: true },
    charCount: { type: Number, default: 0 },
    requirementCount: { type: Number, default: 0 },
    generated: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const RequirementSchema = new Schema(
  {
    documentId: { type: Schema.Types.ObjectId, ref: 'SrsDocument', required: true, index: true },
    code: { type: String, required: true },
    text: { type: String, required: true },
    type: {
      type: String,
      enum: ['functional', 'non-functional', 'constraint', 'unknown'],
      default: 'unknown'
    }
  },
  { timestamps: true }
);

const ModelElementSchema = new Schema(
  {
    documentId: { type: Schema.Types.ObjectId, ref: 'SrsDocument', required: true, index: true },
    kind: {
      type: String,
      enum: ['actor', 'useCase', 'class', 'relationship'],
      required: true
    },
    name: { type: String, default: '' },
    data: { type: Schema.Types.Mixed, default: {} },
    confidence: { type: Number, default: 1 }
  },
  { timestamps: true }
);

const DiagramSchema = new Schema(
  {
    documentId: { type: Schema.Types.ObjectId, ref: 'SrsDocument', required: true, index: true },
    kind: {
      type: String,
      enum: ['useCase', 'class', 'sequence', 'activity', 'state', 'er'],
      required: true
    },
    plantUmlText: { type: String, required: true },
    encoded: { type: String, required: true }
  },
  { timestamps: true }
);

const TestCaseSchema = new Schema(
  {
    documentId: { type: Schema.Types.ObjectId, ref: 'SrsDocument', required: true, index: true },
    testType: { type: String, enum: ['gherkin', 'unit', 'api'], default: 'gherkin', index: true },
    useCase: { type: String, default: '' },
    title: { type: String, default: '' },

    // Gherkin
    gherkinText: { type: String, default: '' },

    // Unit / API
    code: { type: String, default: '' },
    language: { type: String, default: 'javascript' },
    targetClass: { type: String, default: '' },
    endpoint: { type: String, default: '' },
    method: { type: String, default: '' },

    sourceRequirementCodes: { type: [String], default: [] }
  },
  { timestamps: true }
);

const GenerationRunSchema = new Schema(
  {
    documentId: { type: Schema.Types.ObjectId, ref: 'SrsDocument', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    provider: { type: String, default: 'mock' },
    model: { type: String, default: 'heuristic-v1' },
    promptTemplate: { type: String, default: 'extraction.v1' },
    parameters: { type: Schema.Types.Mixed, default: {} },
    tokensUsed: { type: Number, default: 0 },
    rawOutput: { type: String, default: '' },
    status: { type: String, enum: ['success', 'partial', 'failed'], default: 'success' },
    durationMs: { type: Number, default: 0 },
    result: { type: Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

export const User = model('User', UserSchema);
export const Project = model('Project', ProjectSchema);
export const SrsDocument = model('SrsDocument', SrsDocumentSchema);
export const Requirement = model('Requirement', RequirementSchema);
export const ModelElement = model('ModelElement', ModelElementSchema);
export const Diagram = model('Diagram', DiagramSchema);
export const TestCase = model('TestCase', TestCaseSchema);
export const GenerationRun = model('GenerationRun', GenerationRunSchema);