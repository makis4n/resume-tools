/**
 * A structural step kept back from the store until a page shows it (decision 0041).
 *
 * A step that adds, removes or moves a node, or sets a section's role, may stop the template's
 * compile, where an edit of a field's text does not change what the template is asked to set: a
 * locked part that held a list's closer removed, a section whose head opens a list moved below the
 * part that closes it. The third check pins the steps of a locked part it finds stop the compile
 * (`TemplatePackage.pinned`); every other structural step is held here. Its document compiles and
 * shows as any edit's does, but is not saved until a page shows its structure; if the compile
 * stops on it instead, the step is taken back, with every edit made since, and the document is
 * as it was before it, which the store still holds. So a saved document always has a page, and a
 * reload never opens one that does not compile.
 *
 * An imported outline's every change is held so (the second pass's item 7): its fields' text is set
 * in the person's own LaTeX and fonts, which a character typed can stop, and what is taken back on
 * a stop goes to the last document a page showed, within a visit to a field or not
 * (`History.restore`).
 */

import type { Resume } from "@resume-tools/resume-model";
import type { Document, History } from "./document";

/**
 * A resume's structure, as a structural step changes it: its nodes, by id, in order, and its
 * sections' kinds and roles and its links' kinds; nothing of what a field holds.
 */
export function structureOf(resume: Resume): string {
  return JSON.stringify([
    resume.header.links.map((link) => [link.id, link.kind]),
    resume.sections.map((section) => [
      section.id,
      section.kind,
      section.role,
      section.kind === "entries"
        ? section.entries.map((entry) => [entry.id, entry.bullets.map((bullet) => bullet.id)])
        : section.kind === "list" || section.kind === "labelled"
          ? section.items.map((item) => item.id)
          : [],
    ]),
  ]);
}

/**
 * What the guard holds: the history, its last document a page showed, and the step's structure;
 * and where every change is held, the history's present, whose page lets go of it (`every`).
 */
interface Held {
  history: History;
  shown: Document;
  structure: string;
  every?: { latest: Document };
}

/**
 * The guard over the open document's structural steps (the module's comment). The app tells it of
 * every change to the history's present, every page, and every compile that stopped.
 */
export class StructureGuard {
  private held: Held | undefined;

  /**
   * The history `history` went from `before` to its present: whether to save the present now. A
   * structural step is held, and so is every change after it until a page shows it. With `every`,
   * so is every change, a field's text among them, until a page shows the history's present: an
   * imported outline's fields are the person's own LaTeX's, set in fonts that may lack a letter
   * typed, which stops the compile, as a Cyrillic letter does where the fonts have none (the second
   * pass's item 7).
   */
  changed(history: History, before: Document, every = false): boolean {
    const structure = structureOf(history.present.resume);
    if (this.held?.history === history) {
      this.held.structure = structure;
      if (this.held.every !== undefined) this.held.every.latest = history.present;
      return false;
    }
    if (!every && structure === structureOf(before.resume)) return true;
    this.held = {
      history,
      shown: before,
      structure,
      ...(every ? { every: { latest: history.present } } : {}),
    };
    return false;
  }

  /** Whether a step is held for `history`, whose present is then not yet saved. */
  holds(history: History): boolean {
    return this.held?.history === history;
  }

  /**
   * A page came of `document`: whether it shows the held step's structure, which lets go of it, so
   * that the app saves the history's present.
   */
  paged(document: Document): boolean {
    const held = this.held;
    if (held?.every !== undefined) {
      // A page of an earlier document than the present: what a stop now takes back goes to it.
      if (document !== held.every.latest) {
        held.shown = document;
        return false;
      }
      this.held = undefined;
      return true;
    }
    if (held === undefined || structureOf(document.resume) !== held.structure) return false;
    this.held = undefined;
    return true;
  }

  /**
   * The compile of `document` stopped: whether it was the held step's, which then is taken back,
   * the history undone as far as the last document a page showed; the app then shows that, and
   * says so. A compile of another structure stopped for another reason, and is the app's to report.
   */
  stopped(document: Document): boolean {
    const held = this.held;
    if (held?.every !== undefined) {
      // An earlier document's stop: the present compiles next, and says for itself.
      if (document !== held.every.latest) return false;
      this.held = undefined;
      held.history.restore(held.shown);
      return true;
    }
    if (held === undefined || structureOf(document.resume) !== held.structure) return false;
    this.held = undefined;
    while (held.history.present !== held.shown && held.history.undo() !== undefined);
    return true;
  }

  /** Let go of what is held, as when another document opens: nothing of it is saved. */
  forget(): void {
    this.held = undefined;
  }
}
