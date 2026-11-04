import { Router } from 'express';
import {
  Project,
  SrsDocument,
  Requirement,
  ModelElement,
  Diagram,
  TestCase,
  GenerationRun
} from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { getOwnedProject, getOwnedDocument } from '../utils/access.js';
import { extractTextFromFile, segmentRequirements } from '../services/parser.service.js';
import { extractModel } from '../services/extraction.service.js';
import {
  buildUseCasePlantUml,
  buildClassPlantUml,
  buildSequencePlantUml,
  buildActivityPlantUml,
  buildStatePlantUml,
  buildErPlantUml,
  buildGherkin,
  buildUnitTestSkeletons,
  buildApiTestSkeletons
} from '../services/generator.service.js';
import plantumlEncoder from 'plantuml-encoder';

const router = Router();

const publicDocument = (doc) => ({
  id: doc._id.toString(),
  fileName: doc.fileName,
  mimeType: doc.mimeType,
  sizeBytes: doc.sizeBytes,
  charCount: doc.charCount,
  requirementCount: doc.requirementCount,
  createdAt: doc.createdAt
});

const DIAGRAM_KINDS = ['useCase', 'class', 'sequence', 'activity', 'state', 'er'];

async function buildResultPayload(doc) {
  const [requirements, run, diagrams, tests] = await Promise.all([
    Requirement.find({ documentId: doc._id }).sort({ code: 1 }).lean(),
    GenerationRun.findOne({ documentId: doc._id }).sort({ createdAt: -1 }).lean(),
    Diagram.find({ documentId: doc._id }).lean(),
    TestCase.find({ documentId: doc._id }).sort({ createdAt: 1 }).lean()
  ]);

  const base = {
    document: publicDocument(doc),
    srsText: doc.extractedText,
    requirements: requirements.map((r) => ({ code: r.code, text: r.text, type: r.type })),
    generated: Boolean(run)
  };

  if (!run) return base;

  const diagramMap = {};
  for (const kind of DIAGRAM_KINDS) {
    const found = diagrams.find((d) => d.kind === kind);
    diagramMap[kind] = found
      ? { plantUmlText: found.plantUmlText, encoded: found.encoded }
      : null;
  }

  return {
    ...base,
    run: {
      provider: run.provider,
      model: run.model,
      status: run.status,
      tokensUsed: run.tokensUsed,
      durationMs: run.durationMs,
      createdAt: run.createdAt
    },
    elements: run.result,
    diagrams: diagramMap,
    tests: tests.map((t) => ({
      id: t._id.toString(),
      testType: t.testType || 'gherkin',
      useCase: t.useCase || '',
      title: t.title || '',
      gherkinText: t.gherkinText || '',
      code: t.code || '',
      language: t.language || 'javascript',
      targetClass: t.targetClass || '',
      endpoint: t.endpoint || '',
      method: t.method || '',
      sourceRequirementCodes: t.sourceRequirementCodes || []
    }))
  };
}

/* ------------------------------ upload ------------------------------ */

router.post(
  '/projects/:projectId/documents',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const project = await getOwnedProject(req.params.projectId, req.user._id);
    if (!req.file) throw new ApiError(400, 'No file uploaded (field name must be "file")');

    const text = await extractTextFromFile(req.file);
    if (!text || text.length < 20) {
      throw new ApiError(422, 'Could not extract meaningful text from this file');
    }

    const document = await SrsDocument.create({
      projectId: project._id,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      extractedText: text,
      charCount: text.length
    });

    const segments = segmentRequirements(text);
    const requirements = segments.length
      ? await Requirement.insertMany(segments.map((s) => ({ ...s, documentId: document._id })))
      : [];

    document.requirementCount = requirements.length;
    await document.save();

    project.latestDocumentId = document._id;
    await project.save();

    res.status(201).json({
      document: publicDocument(document),
      preview: text.slice(0, 3000),
      requirements: requirements.map((r) => ({ code: r.code, text: r.text, type: r.type }))
    });
  })
);

/* --------------------------- list documents -------------------------- */

router.get(
  '/projects/:projectId/documents',
  requireAuth,
  asyncHandler(async (req, res) => {
    const project = await getOwnedProject(req.params.projectId, req.user._id);
    const documents = await SrsDocument.find({ projectId: project._id }).sort({ createdAt: -1 });
    res.json({ documents: documents.map(publicDocument) });
  })
);

/* ------------------------------ generate ----------------------------- */

router.post(
  '/documents/:documentId/generate',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);

    const requirements = await Requirement.find({ documentId: document._id }).sort({ code: 1 }).lean();
    if (requirements.length === 0) {
      throw new ApiError(422, 'This document has no segmented requirements.');
    }

    const startedAt = Date.now();
    const { result, meta } = await extractModel({
      requirements,
      rawSrsText: document.extractedText
    });

    await Promise.all([
      Diagram.deleteMany({ documentId: document._id }),
      TestCase.deleteMany({ documentId: document._id }),
      ModelElement.deleteMany({ documentId: document._id })
    ]);

    const firstUseCase = (result.useCases || [])[0]?.name || '';
    const firstClass = (result.classes || [])[0]?.name || '';

    const diagramSpecs = [
      { kind: 'useCase', text: buildUseCasePlantUml(result) },
      { kind: 'class', text: buildClassPlantUml(result) },
      { kind: 'sequence', text: buildSequencePlantUml(result, firstUseCase) },
      { kind: 'activity', text: buildActivityPlantUml(result, firstUseCase) },
      { kind: 'state', text: buildStatePlantUml(result, firstClass) },
      { kind: 'er', text: buildErPlantUml(result) }
    ];

    await Diagram.insertMany(
      diagramSpecs.map((d) => ({
        documentId: document._id,
        kind: d.kind,
        plantUmlText: d.text,
        encoded: plantumlEncoder.encode(d.text)
      }))
    );

    const gherkinDocs = (result.tests || []).map((test, i) => ({
      documentId: document._id,
      testType: 'gherkin',
      useCase: test.useCase,
      title: test.title || `Scenario ${i + 1}`,
      gherkinText: buildGherkin(test, i + 1),
      sourceRequirementCodes: test.sourceRequirementCodes || []
    }));

    const unitDocs = buildUnitTestSkeletons(result).map((t) => ({
      documentId: document._id,
      testType: 'unit',
      targetClass: t.targetClass,
      title: t.title,
      code: t.code,
      language: t.language,
      sourceRequirementCodes: []
    }));

    const apiDocs = buildApiTestSkeletons(result).map((t) => ({
      documentId: document._id,
      testType: 'api',
      useCase: t.useCase,
      title: t.title,
      code: t.code,
      language: t.language,
      endpoint: t.endpoint,
      method: t.method,
      sourceRequirementCodes: t.sourceRequirementCodes || []
    }));

    const allTestDocs = [...gherkinDocs, ...unitDocs, ...apiDocs];
    if (allTestDocs.length) await TestCase.insertMany(allTestDocs);

    const elementDocs = [
      ...result.actors.map((a) => ({ documentId: document._id, kind: 'actor', name: a.name, data: a })),
      ...result.useCases.map((u) => ({ documentId: document._id, kind: 'useCase', name: u.name, data: u })),
      ...result.classes.map((c) => ({ documentId: document._id, kind: 'class', name: c.name, data: c })),
      ...result.relationships.map((r) => ({
        documentId: document._id,
        kind: 'relationship',
        name: `${r.source}->${r.target}`,
        data: r
      }))
    ];
    if (elementDocs.length) await ModelElement.insertMany(elementDocs);

    await GenerationRun.create({
      documentId: document._id,
      projectId: document.projectId,
      provider: meta.provider,
      model: meta.model,
      promptTemplate: meta.promptTemplate,
      parameters: meta.parameters,
      tokensUsed: meta.tokensUsed,
      rawOutput: meta.rawOutput,
      status: meta.status,
      durationMs: Date.now() - startedAt,
      result
    });

    res.json(await buildResultPayload(document));
  })
);

/* ------------------------------- result ------------------------------ */

router.get(
  '/documents/:documentId/result',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);
    res.json(await buildResultPayload(document));
  })
);

/* ------------------------------- delete ------------------------------ */

router.delete(
  '/documents/:documentId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);
    await Promise.all([
      Requirement.deleteMany({ documentId: document._id }),
      ModelElement.deleteMany({ documentId: document._id }),
      Diagram.deleteMany({ documentId: document._id }),
      TestCase.deleteMany({ documentId: document._id }),
      GenerationRun.deleteMany({ documentId: document._id })
    ]);
    await document.deleteOne();
    res.json({ ok: true });
  })
);

export default router;