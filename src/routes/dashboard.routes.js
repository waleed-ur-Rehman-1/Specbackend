import { Router } from 'express';
import {
  Project,
  SrsDocument,
  Requirement,
  TestCase,
  ModelElement,
  GenerationRun
} from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projects = await Project.find({ ownerId: req.user._id }).lean();
    const projectIds = projects.map((p) => p._id);

    const documents = await SrsDocument.find({ projectId: { $in: projectIds } })
      .select('_id')
      .lean();
    const documentIds = documents.map((d) => d._id);

    const [totalRequirements, totalTests, totalModelElements, totalRuns] = await Promise.all([
      Requirement.countDocuments({ documentId: { $in: documentIds } }),
      TestCase.countDocuments({ documentId: { $in: documentIds } }),
      ModelElement.countDocuments({ documentId: { $in: documentIds } }),
      GenerationRun.countDocuments({ projectId: { $in: projectIds } })
    ]);

    const byStatus = { draft: 0, running: 0, done: 0, failed: 0 };
    for (const p of projects) {
      const key = p.genStatus || 'draft';
      byStatus[key] = (byStatus[key] || 0) + 1;
    }

    const recentProjects = [...projects]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 6)
      .map((p) => ({
        id: p._id.toString(),
        name: p.name,
        brief: p.brief || '',
        genStatus: p.genStatus || 'draft',
        genStage: p.genStage || 'idle',
        createdAt: p.createdAt
      }));

    res.json({
      totals: {
        projects: projects.length,
        requirements: totalRequirements,
        tests: totalTests,
        modelElements: totalModelElements,
        runs: totalRuns
      },
      byStatus,
      recentProjects
    });
  })
);

export default router;