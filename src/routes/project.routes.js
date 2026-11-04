import { Router } from 'express';
import { z } from 'zod';
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
import { getOwnedProject } from '../utils/access.js';
import { runPipeline } from '../services/pipeline.service.js';

const router = Router();
router.use(requireAuth);

const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  brief: z.string().trim().max(2000).optional().default(''),
  answers: z
    .object({
      actors: z.array(z.string()).optional().default([]),
      goal: z.string().optional().default(''),
      features: z.array(z.string()).optional().default([]),
      nfrPriorities: z.array(z.string()).optional().default([]),
      stack: z.string().optional().default('MERN'),
      database: z.string().optional().default('MongoDB'),
      deployment: z.string().optional().default('Docker'),
      scale: z.string().optional().default('medium'),
      advancements: z.array(z.string()).optional().default([]),
      extraNotes: z.string().optional().default('')
    })
    .optional()
    .nullable()
});

const publicProject = (project) => ({
  id: project._id.toString(),
  name: project.name,
  description: project.description,
  brief: project.brief || '',
  answers: project.answers || null,
  status: project.status,
  createdAt: project.createdAt,
  genStatus: project.genStatus || 'draft',
  genStage: project.genStage || 'idle',
  genError: project.genError || '',
  latestDocumentId: project.latestDocumentId ? project.latestDocumentId.toString() : null
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projects = await Project.find({ ownerId: req.user._id }).sort({ createdAt: -1 });
    res.json({ projects: projects.map(publicProject) });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Invalid project details', parsed.error.issues);

    const project = await Project.create({
      ...parsed.data,
      ownerId: req.user._id,
      genStatus: 'running',
      genStage: 'srs'
    });

    runPipeline(project._id).catch((err) => console.error('[pipeline]', err));

    res.status(201).json({ project: publicProject(project) });
  })
);

router.get(
  '/:projectId',
  asyncHandler(async (req, res) => {
    const project = await getOwnedProject(req.params.projectId, req.user._id);
    res.json({ project: publicProject(project) });
  })
);

router.post(
  '/:projectId/regenerate',
  asyncHandler(async (req, res) => {
    const project = await getOwnedProject(req.params.projectId, req.user._id);
    const documents = await SrsDocument.find({ projectId: project._id }).select('_id');
    const documentIds = documents.map((d) => d._id);

    await Promise.all([
      Requirement.deleteMany({ documentId: { $in: documentIds } }),
      ModelElement.deleteMany({ documentId: { $in: documentIds } }),
      Diagram.deleteMany({ documentId: { $in: documentIds } }),
      TestCase.deleteMany({ documentId: { $in: documentIds } }),
      GenerationRun.deleteMany({ documentId: { $in: documentIds } }),
      SrsDocument.deleteMany({ projectId: project._id })
    ]);

    project.genStatus = 'running';
    project.genStage = 'srs';
    project.genError = '';
    project.latestDocumentId = null;
    await project.save();

    runPipeline(project._id).catch((err) => console.error('[pipeline]', err));

    res.json({ project: publicProject(project) });
  })
);

router.delete(
  '/:projectId',
  asyncHandler(async (req, res) => {
    const project = await getOwnedProject(req.params.projectId, req.user._id);
    const documents = await SrsDocument.find({ projectId: project._id }).select('_id');
    const documentIds = documents.map((d) => d._id);

    await Promise.all([
      Requirement.deleteMany({ documentId: { $in: documentIds } }),
      ModelElement.deleteMany({ documentId: { $in: documentIds } }),
      Diagram.deleteMany({ documentId: { $in: documentIds } }),
      TestCase.deleteMany({ documentId: { $in: documentIds } }),
      GenerationRun.deleteMany({ documentId: { $in: documentIds } }),
      SrsDocument.deleteMany({ projectId: project._id })
    ]);

    await project.deleteOne();
    res.json({ ok: true });
  })
);

export default router;