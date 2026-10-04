/**
 * The review of a resume read from a PDF (milestone 3 second pass, item 14): the PDF's pages beside
 * the resume as read, set on the template picked, with what was read in doubt listed first. It
 * says, before anything else, that the import keeps the content and not the PDF's look, and who
 * read the PDF: the reading service, or the editor's rules and why (`whoRead`).
 *
 * The person corrects the resume as they would edit a document: on the template's page, by
 * clicking a field (`Overlay`), and in the side panel (`Panel`), each a command on the review's own
 * draft, which the engine sets again. They pick one of the three built-in templates, and create the
 * document, which is then an ordinary one of that template; or cancel, and nothing is kept.
 *
 * Plain HTML in plain English, with nothing in it that is LaTeX.
 */

import type { Resume } from "@resume-tools/resume-model";
import { type CSSProperties, useId, useState } from "react";
import type { FontLibrary } from "../page/fonts";
import { Pages } from "../page/Page";
import { whoRead } from "../pdf/consent";
import type { Flag } from "../pdf/file";
import { CURATED, curated } from "../templates/curated";
import type { Shown } from "./compiler";
import { TEMPLATE_LINES } from "./DocumentList";
import type { Command } from "./document";
import { Overlay } from "./Overlay";
import { firstWords, Panel, shownFieldsOf } from "./Panel";
import type { Review } from "./pdf-import";

/** The review's heading. */
export const REVIEW_TITLE = "Review the resume read from your PDF";

/** What a PDF import promises, said before the person creates the document. */
export const CONTENT_NOT_LOOK =
  "This keeps your content, not your PDF's look: the template you pick sets the look. Correct anything read wrongly, on the template's page or in the panel, then create the document.";

/** The heading over what was read in doubt, which comes first. */
export const FLAGS_TITLE = "Check these first";

/** What the review says when nothing read was in doubt. */
export const NO_FLAGS = "Nothing read was in doubt, but check the page all the same.";

/** What stands in for the PDF's pages when they could not be drawn. */
export const NO_PICTURES = "Your PDF's pages could not be shown here.";

/** What the template's pane says while the engine sets the resume. */
export const SETTING = "Setting your resume on the template…";

/** The two ways out of the review. */
export const CREATE = "Create document";
export const CREATING = "Creating…";
export const CANCEL = "Cancel";

/** Where a flag's node is, in words, or undefined when the person has since removed or settled it. */
export function flagPlace(resume: Resume, flag: Flag): string | undefined {
  for (const section of resume.sections) {
    if (flag.kind === "date-as-text" && section.kind === "entries") {
      const entry = section.entries.find((each) => each.id === flag.node);
      // A date the person has since set settles the flag.
      if (entry !== undefined)
        return entry.dates === undefined
          ? `in the entry “${firstWords(entry.title || entry.subtitle || section.title)}”`
          : undefined;
    }
    if (flag.kind === "unfiled" && (section.kind === "list" || section.kind === "labelled")) {
      if (section.items.some((each) => each.id === flag.node))
        return `in “${firstWords(section.title)}”, at the end`;
    }
  }
  return undefined;
}

/** A flag in one plain sentence, or undefined once it no longer stands. */
export function flagLine(resume: Resume, flag: Flag): string | undefined {
  const place = flagPlace(resume, flag);
  if (place === undefined) return undefined;
  const text = `“${firstWords(flag.text, 12, 96)}”`;
  return flag.kind === "date-as-text"
    ? `A date the editor could not read as a date, kept as text ${place}: ${text}.`
    : `Text the editor could not place in a section, kept ${place}: ${text}.`;
}

const STYLE = {
  columns: { display: "flex", alignItems: "flex-start", gap: "1.5rem", flexWrap: "wrap" },
  pdf: { flex: "none", width: "26rem", display: "grid", gap: "1rem" },
  picture: { width: "100%", height: "auto", boxShadow: "0 0 0 1px #ddd", display: "block" },
  sheet: { position: "relative" },
  side: { flex: "none", width: "24rem" },
} satisfies Record<string, CSSProperties>;

export interface PdfReviewProps {
  review: Review;
  /** The template's latest page of the draft, the app's compiler's, once one has come. */
  shown?: Shown;
  /** Why no page came, in the compiler's plain words. */
  error?: string;
  /** The TeX Live fonts the page is drawn from, which a rich field's editor loads fonts from. */
  fonts?: FontLibrary;
  onTemplate(id: string): void;
  onCommand(command: Command, group?: string): void;
  onSeal(): void;
  onCreate(): void;
  onCancel(): void;
}

export function PdfReview({
  review,
  shown,
  error,
  fonts,
  onTemplate,
  onCommand,
  onSeal,
  onCreate,
  onCancel,
}: PdfReviewProps) {
  const { read, pictures, document, creating, notice } = review;
  const title = useId();
  const flagsTitle = useId();
  const [clicked, setClicked] = useState<{ field: string; offset: number; click: number }>();
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  const pkg = curated(document.template).package;
  // A page of another template, from before the person picked this one, is not this one's.
  const page = shown?.document.template === document.template ? shown : undefined;
  const flags = read.filed.flags.flatMap((flag) => {
    const line = flagLine(document.resume, flag);
    return line === undefined ? [] : [{ flag, line }];
  });
  const pickTemplate = (id: string) => {
    setClicked(undefined);
    onTemplate(id);
  };
  const closeField = () => {
    onSeal();
    setClicked(undefined);
  };
  return (
    <main aria-labelledby={title}>
      <h1 id={title}>{REVIEW_TITLE}</h1>
      <p>{CONTENT_NOT_LOOK}</p>
      <p role="status">{whoRead(read.labels)}</p>
      <section aria-labelledby={flagsTitle}>
        <h2 id={flagsTitle}>{FLAGS_TITLE}</h2>
        {flags.length === 0 ? (
          <p>{NO_FLAGS}</p>
        ) : (
          <ul aria-label="Flagged">
            {flags.map(({ flag, line }) => (
              <li key={`${flag.kind}:${flag.line}:${flag.node}`}>{line}</li>
            ))}
          </ul>
        )}
      </section>
      <fieldset disabled={creating}>
        <legend>Template</legend>
        {[...CURATED.values()].map(({ package: each }) => (
          <label key={each.id} style={{ display: "block" }}>
            <input
              type="radio"
              name="pdf-review-template"
              value={each.id}
              aria-label={each.name}
              aria-describedby={`${title}-${each.id}`}
              checked={document.template === each.id}
              onChange={() => pickTemplate(each.id)}
            />{" "}
            {each.name}: <span id={`${title}-${each.id}`}>{TEMPLATE_LINES[each.id] ?? ""}</span>
          </label>
        ))}
      </fieldset>
      <p>
        <button type="button" onClick={onCreate} disabled={creating}>
          {creating ? CREATING : CREATE}
        </button>{" "}
        <button type="button" onClick={onCancel} disabled={creating}>
          {CANCEL}
        </button>
      </p>
      {notice && <p role="alert">{notice}</p>}
      <div style={STYLE.columns}>
        <section aria-label="Your PDF" style={STYLE.pdf}>
          <h2>Your PDF</h2>
          {pictures === undefined ? (
            <p>{NO_PICTURES}</p>
          ) : (
            pictures.map((picture, index) => (
              <img
                // The PDF's pages never change while the review is up.
                key={picture.url}
                src={picture.url}
                width={picture.width}
                height={picture.height}
                alt={`Page ${index + 1} of your PDF`}
                style={STYLE.picture}
              />
            ))
          )}
        </section>
        <section aria-label={`On ${pkg.name}`} inert={creating}>
          <h2>On {pkg.name}</h2>
          {error !== undefined && <p role="alert">{error}</p>}
          {page === undefined ? (
            error === undefined && <p>{SETTING}</p>
          ) : (
            <div ref={setSheet} style={STYLE.sheet}>
              <Pages
                pages={page.pages}
                onField={(field, offset) => {
                  onSeal();
                  setClicked((before) => ({ field, offset, click: (before?.click ?? 0) + 1 }));
                }}
              />
              {clicked && sheet && (
                <Overlay
                  key={clicked.click}
                  field={clicked.field}
                  offset={clicked.offset}
                  document={document}
                  shown={page}
                  page={sheet}
                  {...(fonts === undefined ? {} : { fonts })}
                  onCommand={(command) => onCommand(command, `field:${clicked.field}`)}
                  onClose={closeField}
                />
              )}
            </div>
          )}
        </section>
        <aside aria-label="What was read" style={STYLE.side} inert={creating}>
          <h2>What was read</h2>
          <Panel
            document={document}
            pkg={pkg}
            shownFields={shownFieldsOf(page, document, error !== undefined && page === undefined)}
            onCommand={onCommand}
            onSeal={onSeal}
          />
        </aside>
      </div>
    </main>
  );
}
