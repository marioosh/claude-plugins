// Paths and names of a change (shared by change.mjs, plan.mjs, history.mjs).

import { assertId } from './ids.mjs';

export const CHANGES_DIR = 'changes';
export const BRANCH_PREFIX = 'feature/';

export const changeDir = (id) => `${CHANGES_DIR}/${assertId(id)}`;
export const specPath = (id) => `${changeDir(id)}/spec.md`;
export const branchFor = (id) => `${BRANCH_PREFIX}${assertId(id)}`;
