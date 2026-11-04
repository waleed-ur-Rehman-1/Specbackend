import mongoose from 'mongoose';
import { ApiError } from './ApiError.js';
import { Project, SrsDocument } from '../models/index.js';

export async function getOwnedProject(projectId, userId) {
  if (!mongoose.isValidObjectId(projectId)) throw new ApiError(400, 'Invalid project id');
  const project = await Project.findOne({ _id: projectId, ownerId: userId });
  if (!project) throw new ApiError(404, 'Project not found');
  return project;
}

export async function getOwnedDocument(documentId, userId) {
  if (!mongoose.isValidObjectId(documentId)) throw new ApiError(400, 'Invalid document id');
  const doc = await SrsDocument.findById(documentId);
  if (!doc) throw new ApiError(404, 'Document not found');
  const project = await Project.findOne({ _id: doc.projectId, ownerId: userId });
  if (!project) throw new ApiError(403, 'You do not have access to this document');
  return doc;
}