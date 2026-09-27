/**
 * What an imported document holds beyond model version 1 as this branch has it (milestone 3 items 7
 * and 15, decision 0026): a `locked` section kind, which holds a part of the upload that no snippet
 * can express as the upload wrote it, and the extras a node keeps of what the model lacks, which a
 * snippet writes back through a raw extras slot, `{{&x.<key>}}`. Both are the only bytes the
 * generator writes that its escaper did not see: they are the person's own upload, they compile in
 * the person's own browser, and they never reach a snippet or the naming cache.
 *
 * TODO(merge): part A of item 7 (decision 0025) adds the `locked` section kind to
 * `packages/resume-model` as the fifth member of `Section`, `KeptLatex` and `ExtraKey` for extras,
 * and the `{{&x.<key>}}`, `{{#x.<key>}}` and `{{^x.<key>}}` slots on the header, sections and
 * entries to the snippet language and the generator, which writes a locked section as
 * `\rtlocked{<id>}{<latex>`, a line's end and `}`. These types stand in for them until the two
 * parts merge: `ImportedResume` becomes the model's `Resume`, and `render.ts` goes, the checks
 * calling `generateBody`.
 */

import type { Header, Resume, Section } from "@resume-tools/resume-model";
import type { ControlValues } from "../templates/package";

/**
 * A part of the upload no snippet can express, kept as the upload wrote it: its LaTeX, which the
 * generator writes verbatim where the section stands, inside lock markers where they survive.
 * TODO(merge): part A's model type.
 */
export interface LockedSection {
  kind: "locked";
  id: string;
  title: "";
  role: "other";
  latex: string;
  extras?: Record<string, string>;
}

/** A section of an imported document: the model's, or a locked one. */
export type ImportedSection = Section | LockedSection;

/** An imported resume: the model's, whose sections may be locked. TODO(merge): part A's `Resume`. */
export type ImportedResume = Omit<Resume, "sections"> & { sections: ImportedSection[] };

/** An imported document, as `document.ts`'s `Document` is, with an imported resume. */
export interface ImportedDocument {
  version: 1;
  template: string;
  resume: ImportedResume;
  controls: ControlValues;
}

/** An extras key, as part A takes one: a lowercase letter, then letters, digits and dashes. */
export const EXTRAS_KEY = /^[a-z][a-z0-9-]{0,31}$/;

/** A raw extras slot for `key`: the node's `extras[key]`, written as it is. */
export const extrasSlot = (key: string) => `{{&x.${key}}}`;

/** The extras slots a snippet holds, with their keys. */
export const EXTRAS_SLOT = /\{\{&x\.([a-z][a-z0-9-]{0,31})\}\}/g;

/** A node's extra under `key`, as the generator writes it: its text, or nothing. */
export function extraOf(node: { extras?: Record<string, unknown> } | undefined, key: string) {
  const value =
    node?.extras !== undefined && Object.hasOwn(node.extras, key) ? node.extras[key] : "";
  return typeof value === "string" ? value : "";
}

/** Whether a section is locked. */
export const isLocked = (section: ImportedSection): section is LockedSection =>
  section.kind === "locked";

/** The header, with extras, as an imported document holds it. */
export type ImportedHeader = Header;
