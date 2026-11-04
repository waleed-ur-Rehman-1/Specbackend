import { Router } from 'express';
import {
  Diagram,
  TestCase,
  Requirement,
  GenerationRun,
  Project
} from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getOwnedDocument } from '../utils/access.js';
import {
  streamPdf,
  buildDocxBuffer,
  streamDiagramPdf,
  streamFullReportPdf
} from '../services/exportDoc.service.js';
import {
  buildJiraCsv,
  buildGithubIssuesMarkdown
} from '../services/generator.service.js';

const router = Router();

const safeName = (v) => String(v || 'export').replace(/[^\w.-]+/g, '_').slice(0, 60);

/* ---------------- PlantUML source ---------------- */

router.get(
  '/documents/:documentId/export/plantuml',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);
    const kind = ['useCase', 'class', 'sequence', 'activity', 'state', 'er'].includes(req.query.kind)
      ? req.query.kind
      : 'useCase';

    const diagram = await Diagram.findOne({ documentId: document._id, kind });
    if (!diagram) throw new ApiError(404, 'No generated diagram available yet');

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName(document.fileName)}-${kind}.puml"`
    );
    res.send(diagram.plantUmlText);
  })
);

/* ---------------- Diagram PDF (rendered image) ---------------- */

router.get(
  '/documents/:documentId/export/diagram/pdf',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);
    const kind = ['useCase', 'class', 'sequence', 'activity', 'state', 'er'].includes(req.query.kind)
      ? req.query.kind
      : 'useCase';

    const diagram = await Diagram.findOne({ documentId: document._id, kind });
    if (!diagram) throw new ApiError(404, 'No generated diagram available yet');

    const project = await Project.findById(document.projectId).lean();
    const projectName = project?.name || 'Project';
    const LABELS = {
      useCase: 'Use-Case Diagram',
      class: 'Class Diagram',
      sequence: 'Sequence Diagram',
      activity: 'Activity Diagram',
      state: 'State Diagram',
      er: 'Entity-Relationship Diagram'
    };

    await streamDiagramPdf(res, {
      title: `${projectName} — ${LABELS[kind] || kind}`,
      encoded: diagram.encoded,
      fileName: `${projectName}-${kind}-diagram.pdf`
    });
  })
);

/* ---------------- Full report PDF (SRS + all 6 diagrams + all tests) ---------------- */

router.get(
  '/documents/:documentId/export/full-report/pdf',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);

    const [project, ...diagramDocs] = await Promise.all([
      Project.findById(document.projectId).lean(),
      Diagram.findOne({ documentId: document._id, kind: 'useCase' }).lean(),
      Diagram.findOne({ documentId: document._id, kind: 'class' }).lean(),
      Diagram.findOne({ documentId: document._id, kind: 'sequence' }).lean(),
      Diagram.findOne({ documentId: document._id, kind: 'activity' }).lean(),
      Diagram.findOne({ documentId: document._id, kind: 'state' }).lean(),
      Diagram.findOne({ documentId: document._id, kind: 'er' }).lean()
    ]);

    const tests = await TestCase.find({ documentId: document._id })
      .sort({ createdAt: 1 })
      .lean();

    const kinds = ['useCase', 'class', 'sequence', 'activity', 'state', 'er'];
    const diagrams = {};
    kinds.forEach((k, i) => {
      if (diagramDocs[i]) diagrams[k] = diagramDocs[i];
    });

    const projectName = project?.name || 'Software Requirements Specification';

    await streamFullReportPdf(res, {
      title: projectName,
      markdown: document.extractedText || '',
      diagrams,
      tests: tests.map((t) => ({
        title: t.title,
        useCase: t.useCase,
        testType: t.testType || 'gherkin',
        gherkinText: t.gherkinText || t.code || ''
      })),
      fileName: `${projectName}-full-report.pdf`
    });
  })
);

/* ---------------- Gherkin bundle ---------------- */

router.get(
  '/documents/:documentId/export/features',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);
    const tests = await TestCase.find({ documentId: document._id, testType: 'gherkin' })
      .sort({ createdAt: 1 });

    if (tests.length === 0) throw new ApiError(404, 'No Gherkin tests generated yet');

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName(document.fileName)}.feature"`
    );
    res.send(tests.map((t) => t.gherkinText).join('\n\n'));
  })
);

/* ---------------- Unit-test bundle ---------------- */

router.get(
  '/documents/:documentId/export/unit-tests',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);
    const tests = await TestCase.find({ documentId: document._id, testType: 'unit' })
      .sort({ createdAt: 1 });

    if (tests.length === 0) throw new ApiError(404, 'No unit tests generated yet');

    const body = tests
      .map((t) => `/* ===== ${t.title} ===== */\n\n${t.code}`)
      .join('\n\n');

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName(document.fileName)}-unit-tests.js"`
    );
    res.send(body);
  })
);

/* ---------------- API-test bundle ---------------- */

router.get(
  '/documents/:documentId/export/api-tests',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);
    const tests = await TestCase.find({ documentId: document._id, testType: 'api' })
      .sort({ createdAt: 1 });

    if (tests.length === 0) throw new ApiError(404, 'No API tests generated yet');

    const body = tests
      .map((t) => `/* ===== ${t.title} — ${t.method} ${t.endpoint} ===== */\n\n${t.code}`)
      .join('\n\n');

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName(document.fileName)}-api-tests.js"`
    );
    res.send(body);
  })
);

/* ---------------- Jira CSV ---------------- */

router.get(
  '/documents/:documentId/export/jira-csv',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);
    const [project, requirements, run, tests] = await Promise.all([
      Project.findById(document.projectId).lean(),
      Requirement.find({ documentId: document._id }).sort({ code: 1 }).lean(),
      GenerationRun.findOne({ documentId: document._id }).sort({ createdAt: -1 }).lean(),
      TestCase.find({ documentId: document._id }).lean()
    ]);

    if (!run) throw new ApiError(404, 'Nothing has been generated yet');

    const csv = buildJiraCsv({
      projectName: project?.name || 'Project',
      requirements: requirements.map((r) => ({ code: r.code, text: r.text, type: r.type })),
      model: run.result,
      tests: tests.map((t) => ({
        title: t.title,
        sourceRequirementCodes: t.sourceRequirementCodes
      }))
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName(project?.name || 'jira')}-issues.csv"`
    );
    res.send(csv);
  })
);

/* ---------------- GitHub Issues markdown ---------------- */

router.get(
  '/documents/:documentId/export/github-issues',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);
    const [project, requirements, run, tests] = await Promise.all([
      Project.findById(document.projectId).lean(),
      Requirement.find({ documentId: document._id }).sort({ code: 1 }).lean(),
      GenerationRun.findOne({ documentId: document._id }).sort({ createdAt: -1 }).lean(),
      TestCase.find({ documentId: document._id }).lean()
    ]);

    if (!run) throw new ApiError(404, 'Nothing has been generated yet');

    const md = buildGithubIssuesMarkdown({
      projectName: project?.name || 'Project',
      requirements: requirements.map((r) => ({ code: r.code, text: r.text, type: r.type })),
      model: run.result,
      tests: tests.map((t) => ({
        title: t.title,
        sourceRequirementCodes: t.sourceRequirementCodes
      }))
    });

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName(project?.name || 'github')}-issues.md"`
    );
    res.send(md);
  })
);

/* ---------------- JSON ---------------- */

router.get(
  '/documents/:documentId/export/json',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);

    const [requirements, run, tests] = await Promise.all([
      Requirement.find({ documentId: document._id }).sort({ code: 1 }).lean(),
      GenerationRun.findOne({ documentId: document._id }).sort({ createdAt: -1 }).lean(),
      TestCase.find({ documentId: document._id }).lean()
    ]);
    if (!run) throw new ApiError(404, 'Nothing has been generated yet');

    const payload = {
      document: { fileName: document.fileName, createdAt: document.createdAt },
      srsText: document.extractedText,
      requirements: requirements.map((r) => ({ code: r.code, text: r.text, type: r.type })),
      model: run.result,
      tests: tests.map((t) => ({
        type: t.testType,
        title: t.title,
        useCase: t.useCase,
        code: t.gherkinText || t.code,
        sourceRequirementCodes: t.sourceRequirementCodes
      }))
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName(document.fileName)}-model.json"`
    );
    res.send(JSON.stringify(payload, null, 2));
  })
);

/* ---------------- SRS as PDF ---------------- */

router.get(
  '/documents/:documentId/export/pdf',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);
    if (!document.extractedText) throw new ApiError(404, 'This document has no text');

    const project = await Project.findById(document.projectId).lean();
    const title = project?.name || 'Software Requirements Specification';

    streamPdf(res, {
      title,
      markdown: document.extractedText,
      fileName: `${safeName(project?.name || 'srs')}-srs.pdf`
    });
  })
);

/* ---------------- SRS as DOCX ---------------- */

router.get(
  '/documents/:documentId/export/docx',
  requireAuth,
  asyncHandler(async (req, res) => {
    const document = await getOwnedDocument(req.params.documentId, req.user._id);
    if (!document.extractedText) throw new ApiError(404, 'This document has no text');

    const project = await Project.findById(document.projectId).lean();
    const title = project?.name || 'Software Requirements Specification';

    const buffer = await buildDocxBuffer({ title, markdown: document.extractedText });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName(project?.name || 'srs')}-srs.docx"`
    );
    res.send(buffer);
  })
);

export default router;