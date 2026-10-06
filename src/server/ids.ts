import { randomBytes } from "node:crypto";
import { slugify } from "@/core/util/text";
import { AppError } from "./errors";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Lowercase alphanumeric random id (rejection sampling → no modulo bias). */
export function randomId(length = 12): string {
  let out = "";
  while (out.length < length) {
    const bytes = randomBytes(length * 2);
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      const b = bytes[i];
      if (b < 252) out += ALPHABET[b % 36];
    }
  }
  return out;
}

export const newId = {
  asset: () => `ast_${randomId(10)}`,
  assetRequest: () => `req_${randomId(10)}`,
  render: () => `rnd_${randomId(10)}`,
  job: () => `job_${randomId(12)}`,
  task: () => `task_${randomId(10)}`,
  row: () => `c${randomId(24)}`,
  brandKit: () => `kit_${randomId(10)}`,
  brandKitFile: () => `bkf_${randomId(10)}`,
  review: () => `crv_${randomId(10)}`,
  sceneTemplate: () => `tpl_${randomId(10)}`,
};

/** Project ids double as folder names: lowercase slug + random suffix. */
export const PROJECT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function newProjectId(name: string): string {
  return `${slugify(name, 40)}-${randomId(4)}`;
}

export function assertProjectId(id: unknown): string {
  if (typeof id !== "string" || !PROJECT_ID_RE.test(id)) {
    throw new AppError("BAD_REQUEST", "Invalid project id.");
  }
  return id;
}

const GENERIC_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function assertId(id: unknown, what = "id"): string {
  if (typeof id !== "string" || !GENERIC_ID_RE.test(id)) throw new AppError("BAD_REQUEST", `Invalid ${what}.`);
  return id;
}
