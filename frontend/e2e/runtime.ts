import fs from 'fs';
import path from 'path';

/**
 * Reads the fresh table numbers provisioned by `global-setup.ts`.
 * Falls back to the seed-roles tables (20/21) when run without global setup.
 */
const RUNTIME_PATH = path.resolve('e2e', '.runtime.json');

export interface RuntimeTables {
  desktopTable: number;
  mobileTable: number;
}

export function getTableNumbers(): RuntimeTables {
  try {
    const parsed = JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8')) as RuntimeTables;
    if (Number.isFinite(parsed.desktopTable) && Number.isFinite(parsed.mobileTable)) {
      return parsed;
    }
  } catch {
    /* fall through to defaults */
  }
  return { desktopTable: 20, mobileTable: 21 };
}
