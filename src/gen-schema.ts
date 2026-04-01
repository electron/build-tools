#!/usr/bin/env node
/**
 * Build step: emit evm-config.schema.json from the zod schema in src/types.ts.
 * Run via `yarn build:schema`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { evmConfigSchema } from './types';

const jsonSchema = z.toJSONSchema(evmConfigSchema, {
  target: 'draft-7',
  override: (ctx) => {
    // The refine() on evmConfigSchema enforces one-of-three shapes at runtime
    // but doesn't serialize. Inject the equivalent oneOf so IDE tooling sees
    // the same constraint.
    if (ctx.zodSchema === evmConfigSchema) {
      ctx.jsonSchema['oneOf'] = [
        { required: ['extends'] },
        {
          properties: { defaultTarget: { type: 'string', pattern: 'chrome' } },
          required: ['defaultTarget', 'env', 'root'],
        },
        { required: ['root', 'remotes', 'gen', 'env'] },
      ];
    }
  },
});

const outPath = path.resolve(__dirname, '..', 'evm-config.schema.json');
fs.writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + '\n');
console.log(`Wrote ${outPath}`);
