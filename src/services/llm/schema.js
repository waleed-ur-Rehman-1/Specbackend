import { z } from 'zod';

const codeList = z.array(z.string()).default([]);

export const extractionSchema = z.object({
  actors: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional().default(''),
        sourceRequirementCodes: codeList
      })
    )
    .default([]),
  useCases: z
    .array(
      z.object({
        name: z.string().min(1),
        actors: z.array(z.string()).default([]),
        includes: z.array(z.string()).default([]),
        extends: z.array(z.string()).default([]),
        description: z.string().optional().default(''),
        sourceRequirementCodes: codeList
      })
    )
    .default([]),
  classes: z
    .array(
      z.object({
        name: z.string().min(1),
        attributes: z
          .array(z.object({ name: z.string().min(1), type: z.string().default('String') }))
          .default([]),
        methods: z.array(z.string()).default([]),
        sourceRequirementCodes: codeList
      })
    )
    .default([]),
  relationships: z
    .array(
      z.object({
        source: z.string().min(1),
        target: z.string().min(1),
        type: z.enum(['association', 'aggregation', 'composition', 'inheritance']).default('association'),
        multiplicity: z.string().default('')
      })
    )
    .default([]),
  tests: z
    .array(
      z.object({
        useCase: z.string().default(''),
        title: z.string().default('Scenario'),
        given: z.array(z.string()).default([]),
        when: z.string().default(''),
        then: z.array(z.string()).default([]),
        sourceRequirementCodes: codeList
      })
    )
    .default([])
});

export const EMPTY_MODEL = {
  actors: [],
  useCases: [],
  classes: [],
  relationships: [],
  tests: []
};