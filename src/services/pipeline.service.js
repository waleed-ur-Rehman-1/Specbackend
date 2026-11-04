import {
  Project,
  SrsDocument,
  Requirement,
  ModelElement,
  Diagram,
  TestCase,
  GenerationRun
} from '../models/index.js';
import { generateSrs } from './srsGenerator.service.js';
import { segmentRequirements } from './parser.service.js';
import { extractModel } from './extraction.service.js';
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
} from './generator.service.js';
import plantumlEncoder from 'plantuml-encoder';

async function setStage(project, stage, extra = {}) {
  project.genStage = stage;
  if (extra.status) project.genStatus = extra.status;
  if (extra.error !== undefined) project.genError = extra.error;
  await project.save();
}

export async function runPipeline(projectId) {
  const project = await Project.findById(projectId);
  if (!project) return;

  try {
    await setStage(project, 'srs', { status: 'running', error: '' });

    const srs = await generateSrs(
      project.name,
      project.brief || '',
      project.answers || null
    );

    const document = await SrsDocument.create({
      projectId: project._id,
      fileName: `${project.name.replace(/\s+/g, '-').toLowerCase()}-srs.md`,
      mimeType: 'text/markdown',
      sizeBytes: Buffer.byteLength(srs),
      extractedText: srs,
      charCount: srs.length,
      generated: true
    });

    project.latestDocumentId = document._id;
    await project.save();

    await setStage(project, 'parse');
    const segments = segmentRequirements(srs);
    if (segments.length === 0) throw new Error('The generated SRS contained no requirements.');

    const requirements = await Requirement.insertMany(
      segments.map((s) => ({ ...s, documentId: document._id }))
    );
    document.requirementCount = requirements.length;
    await document.save();

    await setStage(project, 'extract');
    const { result, meta } = await extractModel({ requirements, rawSrsText: srs });

    /* ---------- Build all six diagrams ---------- */
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

    await setStage(project, 'tests');

    /* ---------- Build all three test types ---------- */
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

    /* ---------- Model elements + run record ---------- */
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
      projectId: project._id,
      provider: meta.provider,
      model: meta.model,
      promptTemplate: meta.promptTemplate || 'extraction.v1',
      parameters: meta.parameters,
      tokensUsed: meta.tokensUsed,
      rawOutput: meta.rawOutput,
      status: meta.status,
      durationMs: meta.durationMs,
      result
    });

    await setStage(project, 'done', { status: 'done' });
  } catch (err) {
    console.error('[pipeline] failed:', err);
    await setStage(project, 'idle', { status: 'failed', error: err.message });
  }
}