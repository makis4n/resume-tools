/**
 * The side panel, which holds the resume's structure (plan section 5.3, item 11): the header's
 * contact fields and links, and the sections and what each holds, to add, remove and reorder, with
 * each section's role. Text is edited on the page, where it is read, so the panel names a node by
 * its title or first words rather than repeat it in inputs. Its inputs are for what the page may
 * not show: the header's contact fields, each link's kind and address with its label, and a field
 * the page does not show, which cannot be clicked there, or that still holds its placeholder, so
 * that the input can mark it (`needsInput`). Everything the panel does is a command, as an edit on
 * the page is, so the page recompiles after it. What is typed into one of its inputs, from when
 * the input takes the focus to when it loses it, is one step for undo, as a visit to a field on
 * the page is (item 12); anything else the panel does is a step of its own.
 *
 * An imported template's package says what it requires and what it cannot take (decision 0026):
 * the panel marks a field it requires, which cannot be emptied, gives no input to a slot the
 * document keeps as its upload had it, which is no field, and disables a button that would add a
 * unit the template cannot take, a bullet to an entry whose snippet shows none, or a unit to a list
 * the document keeps whole as its upload had it, and one that would remove a unit the template
 * cannot lose (decision 0038), saying why. A curated package says none of these. A part of an
 * imported resume kept as its upload had it is a row of its own, named by its first words as the
 * page shows them, which moves and is removed and nothing else (decision 0041).
 *
 * Plain HTML in plain English, with nothing in it that is LaTeX.
 */

import {
  type Entry,
  type Header,
  type Item,
  type LabelledItem,
  LINK_KINDS,
  type Link,
  LinkKind,
  type LockedSection,
  type RichText,
  SECTION_KINDS,
  SECTION_ROLES,
  type Section,
  SectionKind,
  SectionRole,
} from "@resume-tools/resume-model";
import {
  type CSSProperties,
  createContext,
  type InputHTMLAttributes,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Report } from "../import/report";
import { type DrawnPage, fieldsShown } from "../page/draw";
import { CURATED } from "../templates/curated";
import { formatDates } from "../templates/dates";
import { isBlank } from "../templates/escape";
import {
  type DateFormat,
  defaultControls,
  type PinStep,
  type TemplatePackage,
  type UnitKind,
} from "../templates/package";
import {
  addable,
  type Command,
  type Document,
  fieldsOf,
  keptOf,
  PLACEHOLDERS,
  pinnedSteps,
  removable,
  requiredFields,
  SECTION_TITLES,
  type StructureOp,
  showsBullets,
} from "./document";

/** How long typing in the panel waits for a pause before it becomes a command, in milliseconds. */
export const PAUSE = 300;

/**
 * Where the panel's commands go. What is typed into an input goes with the group of a visit to
 * what the input edits, so that the visit is one step (`History.dispatch`): `field:<id>` for a
 * field, as on the page; `header:<name>` for one of the header's contact fields, which `setHeader`
 * sets; and `link:<id>` for a link's address, which `setLink` sets. A button or a menu sends its
 * command with no group, which makes the command a step of its own.
 */
type Send = (command: Command, group?: string) => void;

/** A structure op as the command that carries it. */
const structural = (op: StructureOp): Command => ({ type: "structure", op });

/**
 * What a `FieldInput` for a text field is given besides its text: the field's id, and what the
 * input does with what is typed, both from the one id, so that they name the same field.
 */
const textField = (field: string, send: Send) => ({
  field,
  onChange: (text: string) => send({ type: "text", field, text }, `field:${field}`),
});

/** A rich field's text as the page shows it: its runs joined. */
export const plainText = (runs: RichText) => runs.map((run) => run.text).join("");

/**
 * The first words of a text, which name a bullet or an item in the panel without repeating it
 * whole; cut at a number of characters too, since an address is one long word.
 */
export function firstWords(text: string, words = 6, characters = 48): string {
  const all = text.trim().split(/\s+/);
  const start = all.slice(0, words).join(" ");
  if (start.length > characters) return `${start.slice(0, characters).trimEnd()}…`;
  return all.length > words ? `${start}…` : start;
}

/**
 * Where a field stands: `empty` when the page would show nothing for it, by the generator's own
 * test, so that it is not on the page (decision 0007); `placeholder` while it holds the text it
 * started with; and `filled` otherwise.
 */
export function fieldStatus(
  text: string | undefined,
  placeholder?: string,
): "empty" | "placeholder" | "filled" {
  if (text === undefined || isBlank(text)) return "empty";
  return text === placeholder ? "placeholder" : "filled";
}

/**
 * Whether the panel gives a field an input: when the page does not show it, so that it can still
 * be filled in or cleared, and while it holds its placeholder, shown or not, so that the input can
 * mark it. An empty field is never on the page (decision 0007). A filled one is off it when it is
 * not in `shownFields` (`shownFieldsOf`): its template's variant may have no slot for it, as
 * Jake's projects entry has no place, no character of its text may set a glyph, or it may be on a
 * page after the first, which the editor does not draw. Before the first page `shownFields` is
 * undefined, and every field counts as shown, so that the panel does not fill with inputs while
 * the document opens; once the first page could not be made it is empty, and every field needs one.
 */
export function needsInput(
  field: string,
  text: string | undefined,
  placeholder: string | undefined,
  shownFields: ReadonlySet<string> | undefined,
): boolean {
  if (fieldStatus(text, placeholder) !== "filled") return true;
  return shownFields !== undefined && !shownFields.has(field);
}

/**
 * The fields `needsInput` counts as shown, from `latest`, the latest page with the document it was
 * drawn from (the compiler's `Shown`), and `present`, the document the panel shows: those with a
 * glyph on the page (`fieldsShown`), and those the page's document did not have. The page can be
 * a compile behind, and a field added since has had no page to be on yet, so it counts as shown
 * until one comes, as every field does before the first page. Otherwise a new section's title,
 * which is not a placeholder, would get an input for as long as the compile takes and lose it when
 * the page arrives. Undefined while there is no page, unless the first page could not be made
 * (`failed`): then no field is shown, and none will be until an edit compiles, so the set is empty
 * and `needsInput` gives every field an input, where the edit that stopped the compile can be taken
 * back. A page that came before a failure still shows its fields, and goes on counting them.
 */
export function shownFieldsOf(
  latest: { page: Pick<DrawnPage, "fields">; document: Document } | undefined,
  present: Document,
  failed = false,
): Set<string> | undefined {
  if (latest === undefined) return failed ? new Set() : undefined;
  const shown = fieldsShown(latest.page);
  const drawn = fieldsOf(latest.document.resume);
  for (const id of fieldsOf(present.resume).keys()) if (!drawn.has(id)) shown.add(id);
  return shown;
}

/**
 * Each locked section's first words as the page shows them, by its id (`PanelProps.lockedWords`):
 * item 13's report's names (decision 0039), read from the original's page by what sets each of its
 * words, so that a part is named here as the report names it, whatever the editor's page sets
 * around it, and whether or not a page shows it now (decision 0041). A part that sets no word, and
 * every part of an import with no report, gets none.
 */
export function lockedWordsOf(
  report: Pick<Report, "locked"> | undefined,
): ReadonlyMap<string, string> {
  const words = new Map<string, string>();
  for (const part of report?.locked ?? [])
    if (part.section !== undefined && part.words !== "") words.set(part.section, part.words);
  return words;
}

/** The month "Add dates" starts an entry's dates at: this one, as the model writes a month. */
export function thisMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Whether removing a section would lose more than its title, which is when the panel asks. */
export function holdsContent(section: Section): boolean {
  switch (section.kind) {
    case "entries":
      return section.entries.length > 0;
    case "list":
    case "labelled":
      return section.items.length > 0;
    case "paragraph":
      return !isBlank(plainText(section.text));
    case "locked":
      return !isBlank(section.latex);
  }
}

/** Any section but a locked one, which nothing edits and the panel only moves and removes. */
type EditableSection = Exclude<Section, LockedSection>;

/** Each kind of section in plain English. */
const KIND_NAMES: Readonly<Record<SectionKind, string>> = {
  entries: "Entries",
  list: "List",
  labelled: "Labelled list",
  paragraph: "Paragraph",
};

/** Each kind of link as the site it points to names itself. */
const LINK_NAMES: Readonly<Record<LinkKind, string>> = {
  website: "Website",
  linkedin: "LinkedIn",
  github: "GitHub",
  twitter: "Twitter",
  orcid: "ORCID",
  other: "Other",
};

/**
 * The header's fields besides the name, with an input whatever they hold, since the page does not
 * show one while it is empty and a template may not show it at all, as Jake's does not a headline.
 */
const HEADER_FIELDS = [
  { key: "headline", label: "Headline", mode: "text" },
  { key: "email", label: "Email", mode: "email" },
  { key: "phone", label: "Phone", mode: "tel" },
  { key: "location", label: "Location", mode: "text" },
] as const;

/** Just enough layout for a narrow column; the rest is the browser's own. */
const STYLE = {
  panel: { display: "grid", gap: "0.75rem", fontSize: "0.875rem" },
  list: { display: "grid", gap: "0.5rem", margin: "0.5rem 0", paddingLeft: "1.25rem" },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.375rem" },
  mark: { color: "#9a5b00", fontStyle: "italic" },
} satisfies Record<string, CSSProperties>;

/** What a required field's mark and input say when pointed at. */
export const REQUIRED = "The template needs this filled in, so it cannot be left empty";

/** Why a button that would add a unit the template cannot take is disabled. */
const CANNOT_ADD = "The template cannot take another one of these";

/**
 * Why a button that would remove a unit the template cannot lose is disabled: a kind whose units it
 * keeps as they are, since a new one or a removal stops its compile (decision 0038).
 */
const CANNOT_REMOVE = "The template cannot do without one of these";

/** Why the button that would add a bullet to an entry whose snippet shows none is disabled. */
const NO_BULLETS = "The template sets no bullets for an entry of this section";

/** Why the button that would add a unit to a list kept as it was imported is disabled. */
const KEPT = "These were kept as they were imported, so none can be added here";

/** What a locked part is, which names one that has no name of its own. */
export const KEPT_AS_IT_WAS = "Kept as it was";

/**
 * Why a locked part's button is disabled where the template stops after its step (decision 0041):
 * as a part that closes a list a section above it opens.
 */
export const PINNED: Readonly<Record<PinStep, string>> = {
  remove: "The template stops without this part, so it stays",
  up: "The template stops if this part moves up",
  down: "The template stops if this part moves down",
};

/**
 * What the panel shows of a package's rules for the open document (decision 0026): the fields the
 * document has, which a slot it keeps as its upload had it is not (`fieldsOf`), undefined for
 * every field; the fields the package requires (`requiredFields`); whether it takes a new unit of
 * a kind (`addable`), and lets one go (`removable`); and whether an entry of a section of a role
 * shows bullets (`showsBullets`).
 */
interface Rules {
  fields?: ReadonlySet<string>;
  required: ReadonlySet<string>;
  addable: (kind: UnitKind) => boolean;
  removable: (kind: UnitKind) => boolean;
  bullets: (role: SectionRole) => boolean;
  pinned: (id: string) => ReadonlySet<PinStep>;
}

/** A package's rules for a document; with no package, none, and every edit taken. */
function rulesOf(pkg: TemplatePackage | undefined, document: Document): Rules {
  return {
    fields: new Set(fieldsOf(document.resume).keys()),
    required: requiredFields(pkg, document.resume),
    addable: (kind) => addable(pkg, kind),
    removable: (kind) => removable(pkg, kind),
    bullets: (role) => showsBullets(pkg, role),
    pinned: (id) => pinnedSteps(pkg, id),
  };
}

/** A package that says nothing, whose rules take every edit. */
const NO_RULES: Rules = {
  required: new Set(),
  addable: () => true,
  removable: () => true,
  bullets: () => true,
  pinned: () => new Set(),
};

export interface PanelProps {
  document: Document;
  /**
   * The document's package, which says what its template requires and what it cannot take
   * (decision 0026): an imported one's, which the app passes; the curated one of the document's
   * template when it is left out, which says neither.
   */
  pkg?: TemplatePackage;
  /**
   * The fields that count as shown on the page (`shownFieldsOf`), so that a filled field the page
   * does not show gets an input here; undefined before the first page.
   */
  shownFields?: ReadonlySet<string>;
  /**
   * Each locked section's first words as the page shows them, by its id (`lockedWordsOf`), which
   * name its row; a part with none is named `KEPT_AS_IT_WAS`.
   */
  lockedWords?: ReadonlyMap<string, string>;
  /** Where the panel's commands go: the way an edit on the page goes, so the page follows. */
  onCommand: Send;
  /**
   * The end of a visit to one of the panel's inputs, as it loses the focus, which ends the step
   * of what was typed there (`History.seal`), so that the next visit to it is a step of its own.
   */
  onSeal: () => void;
}

/**
 * `PanelProps.shownFields`, carried to each `FieldInput` however deep in the panel it sits rather
 * than passed down through the rows between, which have no use for it.
 */
const ShownFields = createContext<ReadonlySet<string> | undefined>(undefined);

/** `PanelProps.onSeal`, carried to each `TypedInput` in the same way. */
const Seal = createContext<() => void>(() => {});

/** The package's rules (`Rules`), carried to each `FieldInput` and `AddSection` in the same way. */
const RulesOf = createContext<Rules>(NO_RULES);

export function Panel({ document, pkg, shownFields, lockedWords, onCommand, onSeal }: PanelProps) {
  const { header, sections } = document.resume;
  const known = pkg ?? CURATED.get(document.template)?.package;
  const rules = rulesOf(known, document);
  return (
    <ShownFields value={shownFields}>
      <Seal value={onSeal}>
        <RulesOf value={rules}>
          <div style={STYLE.panel}>
            <HeaderFields header={header} rules={rules} send={onCommand} />
            <Links
              links={header.links}
              kept={keptOf(header).has("links")}
              rules={rules}
              send={onCommand}
            />
            <Sections
              sections={sections}
              format={dateFormatOf(document, known)}
              rules={rules}
              lockedWords={lockedWords}
              send={onCommand}
            />
          </div>
        </RulesOf>
      </Seal>
    </ShownFields>
  );
}

/**
 * The date format the page sets dates in: the document's choice, or its template's default, and
 * the generator's own where there is no package to say.
 */
function dateFormatOf(document: Document, pkg: TemplatePackage | undefined): DateFormat {
  const { dateFormat } = document.controls;
  return dateFormat ?? (pkg === undefined ? "MMM yyyy" : defaultControls(pkg).dateFormat);
}

/** The `setHeader` op for one of the header's fields. */
function setHeader(key: (typeof HEADER_FIELDS)[number]["key"], text: string): StructureOp {
  const op: Extract<StructureOp, { op: "setHeader" }> = { op: "setHeader" };
  op[key] = text;
  return op;
}

/** What a required field's input carries: the reason, when pointed at, and the flag. */
const requiredInput = (required: boolean) =>
  required ? { title: REQUIRED, "aria-required": true as const } : {};

/**
 * The header's name, and its other fields each with an input, but a slot the document keeps as
 * its upload had it, which is no field; each marked where the package requires it.
 */
function HeaderFields({ header, rules, send }: { header: Header; rules: Rules; send: Send }) {
  return (
    <fieldset>
      <legend>Header</legend>
      <FieldInput
        label="First name"
        text={header.name.first}
        {...textField("header.first", send)}
      />
      <FieldInput label="Last name" text={header.name.last} {...textField("header.last", send)} />
      {HEADER_FIELDS.map(({ key, label, mode }) => {
        const field = `header.${key}`;
        if (rules.fields !== undefined && !rules.fields.has(field)) return null;
        const required = rules.required.has(field);
        return (
          <label key={key} style={STYLE.row}>
            {label}
            <TypedInput
              value={header[key] ?? ""}
              inputMode={mode}
              {...requiredInput(required)}
              onChange={(value) => send(structural(setHeader(key, value)), `header:${key}`)}
            />
            {required && <Required />}
          </label>
        );
      })}
    </fieldset>
  );
}

/** The header's links, and the button to add one, disabled where the header keeps them whole. */
function Links({
  links,
  kept,
  rules,
  send,
}: {
  links: readonly Link[];
  kept: boolean;
  rules: Rules;
  send: Send;
}) {
  const set = (
    id: string,
    change: { kind?: LinkKind; label?: string; href?: string },
    group?: string,
  ) => send(structural({ op: "setLink", id, ...change }), group);
  return (
    <fieldset>
      <legend>Links</legend>
      {links.length > 0 && (
        <ol style={STYLE.list}>
          {links.map((link, index) => (
            <li key={link.id} style={STYLE.row}>
              <select
                aria-label="Kind of link"
                value={link.kind}
                onChange={(event) => set(link.id, { kind: LinkKind.parse(event.target.value) })}
              >
                {LINK_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {LINK_NAMES[kind]}
                  </option>
                ))}
              </select>
              <label style={STYLE.row}>
                Label
                {/* The label is a field, which the page shows, so typing it here is a visit to
                    that field, as a click on it there is. */}
                <TypedInput
                  value={link.label}
                  {...requiredInput(rules.required.has(`${link.id}.label`))}
                  onChange={(label) => set(link.id, { label }, `field:${link.id}.label`)}
                />
                {fieldStatus(link.label, PLACEHOLDERS.link.label) === "placeholder" && <Mark />}
                {rules.required.has(`${link.id}.label`) && <Required />}
              </label>
              <label style={STYLE.row}>
                Address
                <TypedInput
                  value={link.href}
                  inputMode="url"
                  spellCheck={false}
                  onChange={(href) => set(link.id, { href }, `link:${link.id}`)}
                />
              </label>
              <Reorder
                index={index}
                count={links.length}
                onMove={(to) => send(structural({ op: "moveLink", id: link.id, to }))}
                onRemove={() => send(structural({ op: "removeLink", id: link.id }))}
                refused={rules.removable("link") ? undefined : CANNOT_REMOVE}
              />
            </li>
          ))}
        </ol>
      )}
      <AddButton
        refused={kept ? KEPT : rules.addable("link") ? undefined : CANNOT_ADD}
        onClick={() => send(structural({ op: "addLink" }))}
      >
        Add link
      </AddButton>
    </fieldset>
  );
}

function Sections({
  sections,
  format,
  rules,
  lockedWords,
  send,
}: {
  sections: readonly Section[];
  format: DateFormat;
  rules: Rules;
  lockedWords: ReadonlyMap<string, string> | undefined;
  send: Send;
}) {
  return (
    <fieldset>
      <legend>Sections</legend>
      {sections.length > 0 && (
        <ol style={STYLE.list}>
          {sections.map((section, index) =>
            section.kind === "locked" ? (
              <LockedRow
                key={section.id}
                section={section}
                words={lockedWords?.get(section.id)}
                index={index}
                count={sections.length}
                rules={rules}
                send={send}
              />
            ) : (
              <SectionRow
                key={section.id}
                section={section}
                index={index}
                count={sections.length}
                format={format}
                rules={rules}
                send={send}
              />
            ),
          )}
        </ol>
      )}
      <AddSection send={send} />
    </fieldset>
  );
}

/**
 * A section: its title, which the page edits, its kind, which never changes, and its role, with
 * the buttons that reorder and remove it; and, once opened, what it holds.
 */
function SectionRow({
  section,
  index,
  count,
  format,
  rules,
  send,
}: {
  section: EditableSection;
  index: number;
  count: number;
  format: DateFormat;
  rules: Rules;
  send: Send;
}) {
  const [open, setOpen] = useState(false);
  const { id, title } = section;
  const remove = () => {
    const named = isBlank(title) ? "this section" : `the section “${title}”`;
    if (holdsContent(section) && !confirm(`Remove ${named} and everything in it?`)) return;
    send(structural({ op: "removeSection", id }));
  };
  return (
    <li>
      <div style={STYLE.row}>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {isBlank(title) ? "Untitled section" : title}
        </button>
        <span>{KIND_NAMES[section.kind]}</span>
        <RoleSelect
          role={section.role}
          onChange={(role) => send(structural({ op: "setSection", id, role }))}
        />
        <Reorder
          index={index}
          count={count}
          onMove={(to) => send(structural({ op: "moveSection", id, to }))}
          onRemove={remove}
          refused={rules.removable(`section.${section.kind}`) ? undefined : CANNOT_REMOVE}
        />
      </div>
      <FieldInput label="Title" text={title} {...textField(`${id}.title`, send)} />
      {open && <SectionContents section={section} format={format} rules={rules} send={send} />}
    </li>
  );
}

/**
 * A locked section: a part of an imported resume kept as its upload had it, which the page draws
 * and nothing edits, so the panel moves and removes it, which undo takes back as any step, and
 * shows nothing of what it holds, which is LaTeX. It is named by its first words as the page shows
 * them (`PanelProps.lockedWords`), marked as kept, or `KEPT_AS_IT_WAS` where it has no name
 * (decision 0041).
 */
function LockedRow({
  section,
  words,
  index,
  count,
  rules,
  send,
}: {
  section: LockedSection;
  words: string | undefined;
  index: number;
  count: number;
  rules: Rules;
  send: Send;
}) {
  const { id } = section;
  const named = words === undefined || words === "" ? undefined : words;
  const pinned = rules.pinned(id);
  const remove = () => {
    const what = named === undefined ? "this section" : `“${named}”`;
    if (holdsContent(section) && !confirm(`Remove ${what} and everything in it?`)) return;
    send(structural({ op: "removeSection", id }));
  };
  return (
    <li style={STYLE.row}>
      <span>{named ?? KEPT_AS_IT_WAS}</span>
      {named !== undefined && <small style={STYLE.mark}>{KEPT_AS_IT_WAS.toLowerCase()}</small>}
      <Reorder
        index={index}
        count={count}
        onMove={(to) => send(structural({ op: "moveSection", id, to }))}
        onRemove={remove}
        refused={pinned.has("remove") ? PINNED.remove : undefined}
        up={pinned.has("up") ? PINNED.up : undefined}
        down={pinned.has("down") ? PINNED.down : undefined}
      />
    </li>
  );
}

/**
 * A button that adds a unit, disabled where the template cannot take one, which says why when
 * pointed at.
 */
function AddButton({
  refused,
  onClick,
  children,
}: {
  /** Why the template takes no unit here, if it takes none. */
  refused: string | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={refused !== undefined}
      {...(refused === undefined ? {} : { title: refused })}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** What a section holds, each with the buttons that reorder and remove it, and one to add more. */
function SectionContents({
  section,
  format,
  rules,
  send,
}: {
  section: EditableSection;
  format: DateFormat;
  rules: Rules;
  send: Send;
}) {
  switch (section.kind) {
    case "entries": {
      const { entries } = section;
      const bullets = rules.bullets(section.role)
        ? rules.addable("bullet")
          ? undefined
          : CANNOT_ADD
        : NO_BULLETS;
      return (
        <>
          {entries.length > 0 && (
            <ol style={STYLE.list}>
              {entries.map((entry, index) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  index={index}
                  count={entries.length}
                  format={format}
                  rules={rules}
                  bullets={bullets}
                  send={send}
                />
              ))}
            </ol>
          )}
          <AddButton
            refused={
              keptOf(section).has("entries")
                ? KEPT
                : rules.addable("entry")
                  ? undefined
                  : CANNOT_ADD
            }
            onClick={() => send(structural({ op: "addEntry", section: section.id }))}
          >
            Add entry
          </AddButton>
        </>
      );
    }
    case "list":
    case "labelled": {
      const items: readonly (Item | LabelledItem)[] = section.items;
      const kind = section.kind === "list" ? "item" : "labelledItem";
      return (
        <>
          {items.length > 0 && (
            <ol style={STYLE.list}>
              {items.map((item, index) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  index={index}
                  count={items.length}
                  refused={rules.removable(kind) ? undefined : CANNOT_REMOVE}
                  send={send}
                />
              ))}
            </ol>
          )}
          <AddButton
            refused={
              keptOf(section).has("items") ? KEPT : rules.addable(kind) ? undefined : CANNOT_ADD
            }
            onClick={() => send(structural({ op: "addItem", section: section.id }))}
          >
            Add item
          </AddButton>
        </>
      );
    }
    case "paragraph":
      return (
        <RichField label="Text" field={`${section.id}.text`} runs={section.text} send={send} />
      );
  }
}

/**
 * An entry: its title and dates as the page sets them, the fields the page does not show, and its
 * bullets. Dates are edited on the page (item 9), so an entry without them gets a button here, as
 * it has none on the page to click, unless the entry keeps its dates as its upload had them, when
 * they are no field. `bullets` says why no bullet can be added, where none can.
 */
function EntryRow({
  entry,
  index,
  count,
  format,
  rules,
  bullets: refused,
  send,
}: {
  entry: Entry;
  index: number;
  count: number;
  format: DateFormat;
  rules: Rules;
  bullets: string | undefined;
  send: Send;
}) {
  const { id, bullets } = entry;
  const placeholder = PLACEHOLDERS.entry;
  const dated = rules.fields === undefined || rules.fields.has(`${id}.dates`);
  return (
    <li>
      <div style={STYLE.row}>
        <span>{isBlank(entry.title) ? "Untitled entry" : entry.title}</span>
        {entry.dates ? (
          <span>{formatDates(entry.dates, format)}</span>
        ) : dated ? (
          <button
            type="button"
            onClick={() =>
              send({ type: "dates", field: `${id}.dates`, dates: { start: thisMonth() } })
            }
          >
            Add dates
          </button>
        ) : null}
        <Reorder
          index={index}
          count={count}
          onMove={(to) => send(structural({ op: "moveEntry", id, to }))}
          onRemove={() => send(structural({ op: "removeEntry", id }))}
          refused={rules.removable("entry") ? undefined : CANNOT_REMOVE}
        />
      </div>
      <FieldInput
        label="Title"
        text={entry.title}
        placeholder={placeholder.title}
        {...textField(`${id}.title`, send)}
      />
      <FieldInput
        label="Subtitle"
        text={entry.subtitle}
        placeholder={placeholder.subtitle}
        {...textField(`${id}.subtitle`, send)}
      />
      <FieldInput
        label="Place"
        text={entry.place}
        placeholder={placeholder.place}
        {...textField(`${id}.place`, send)}
      />
      <div style={STYLE.row}>
        {bullets.length === 1 ? "1 bullet" : `${bullets.length} bullets`}
        <AddButton
          refused={keptOf(entry).has("bullets") ? KEPT : refused}
          onClick={() => send(structural({ op: "addBullet", entry: id }))}
        >
          Add bullet
        </AddButton>
      </div>
      {bullets.length > 0 && (
        <ol style={STYLE.list}>
          {bullets.map((bullet, b) => (
            <li key={bullet.id} style={STYLE.row}>
              <RichField
                label="Bullet"
                field={`${bullet.id}.text`}
                runs={bullet.text}
                placeholder={PLACEHOLDERS.bullet}
                send={send}
              />
              <Reorder
                index={b}
                count={bullets.length}
                onMove={(to) => send(structural({ op: "moveBullet", id: bullet.id, to }))}
                onRemove={() => send(structural({ op: "removeBullet", id: bullet.id }))}
                refused={rules.removable("bullet") ? undefined : CANNOT_REMOVE}
              />
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/** An item of a list or labelled section: its label, if it has one, and its first words. */
function ItemRow({
  item,
  index,
  count,
  refused,
  send,
}: {
  item: Item | LabelledItem;
  index: number;
  count: number;
  /** Why the template cannot lose the item, if it cannot. */
  refused: string | undefined;
  send: Send;
}) {
  const labelled = "label" in item;
  return (
    <li style={STYLE.row}>
      {labelled && (
        <FieldInput
          label="Label"
          text={item.label}
          placeholder={PLACEHOLDERS.labelledItem.label}
          {...textField(`${item.id}.label`, send)}
        >
          <b>{item.label}</b>
        </FieldInput>
      )}
      <RichField
        label={labelled ? "Text" : "Item"}
        field={`${item.id}.text`}
        runs={item.text}
        placeholder={labelled ? PLACEHOLDERS.labelledItem.text : PLACEHOLDERS.item}
        send={send}
      />
      <Reorder
        index={index}
        count={count}
        onMove={(to) => send(structural({ op: "moveItem", id: item.id, to }))}
        onRemove={() => send(structural({ op: "removeItem", id: item.id }))}
        refused={refused}
      />
    </li>
  );
}

/**
 * The kind and role of a new section, and the button that adds it at the end: of the kinds the
 * template can take, and none where it takes no new section.
 */
function AddSection({ send }: { send: Send }) {
  const rules = useContext(RulesOf);
  const [chosen, setKind] = useState<SectionKind>("entries");
  const [role, setRole] = useState<SectionRole>("experience");
  const kinds = SECTION_KINDS.filter((each) => rules.addable(`section.${each}`));
  const kind = kinds.includes(chosen) ? chosen : kinds[0];
  if (kind === undefined) return null;
  return (
    <div style={STYLE.row}>
      <label style={STYLE.row}>
        Kind
        <select value={kind} onChange={(event) => setKind(SectionKind.parse(event.target.value))}>
          {kinds.map((each) => (
            <option key={each} value={each}>
              {KIND_NAMES[each]}
            </option>
          ))}
        </select>
      </label>
      <RoleSelect role={role} onChange={setRole} />
      <button type="button" onClick={() => send(structural({ op: "addSection", kind, role }))}>
        Add section
      </button>
    </div>
  );
}

function RoleSelect({
  role,
  onChange,
}: {
  role: SectionRole;
  onChange: (role: SectionRole) => void;
}) {
  return (
    <label style={STYLE.row}>
      Role
      <select value={role} onChange={(event) => onChange(SectionRole.parse(event.target.value))}>
        {SECTION_ROLES.map((each) => (
          <option key={each} value={each}>
            {SECTION_TITLES[each]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Move up, move down and remove, for the node at `index` of the `count` in its list; remove
 * disabled where the template cannot lose the node, which says why when pointed at.
 */
function Reorder({
  index,
  count,
  onMove,
  onRemove,
  refused,
  up,
  down,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
  /** Why the template cannot lose the node, if it cannot. */
  refused?: string | undefined;
  /** Why the template cannot take the node one place up, or down, if it cannot (decision 0041). */
  up?: string | undefined;
  down?: string | undefined;
}) {
  return (
    <span style={STYLE.row}>
      <button
        type="button"
        title={up ?? "Move up"}
        aria-label="Move up"
        disabled={index === 0 || up !== undefined}
        onClick={() => onMove(index - 1)}
      >
        ↑
      </button>
      <button
        type="button"
        title={down ?? "Move down"}
        aria-label="Move down"
        disabled={index === count - 1 || down !== undefined}
        onClick={() => onMove(index + 1)}
      >
        ↓
      </button>
      <button
        type="button"
        disabled={refused !== undefined}
        {...(refused === undefined ? {} : { title: refused })}
        onClick={onRemove}
      >
        Remove
      </button>
    </span>
  );
}

/**
 * A rich field: its first words, or an input while the page does not show it. The input sets the
 * field as one plain run, so a field with bold, italic or a link is left to the page, where those
 * are edited, rather than lose them here.
 */
function RichField({
  label,
  field,
  runs,
  placeholder,
  send,
}: {
  label: string;
  field: string;
  runs: RichText;
  placeholder?: string;
  send: Send;
}) {
  const text = plainText(runs);
  const marked = runs.some((run) => run.bold || run.italic || run.href !== undefined);
  return (
    <FieldInput
      field={field}
      label={label}
      text={text}
      placeholder={placeholder}
      locked={marked && !isBlank(text)}
      onChange={(typed) => send({ type: "rich", field, runs: [{ text: typed }] }, `field:${field}`)}
    >
      <span>{firstWords(text)}</span>
    </FieldInput>
  );
}

/**
 * An input for a field that `needsInput` gives one: a field the page does not show, so that it can
 * still be filled in or cleared, or one that holds its placeholder, which the input marks. Any
 * other field is edited on the page, and the panel shows `children` for it instead. Once the input
 * has had the focus it stays, so that filling the field in does not pull the input, and the panel
 * below it, from under the pointer. A field the package requires is marked, whether it has an
 * input or not, and its input says why (decision 0026); a slot the document keeps as its upload had
 * it is no field, and gets no input.
 */
function FieldInput({
  field,
  label,
  text,
  placeholder,
  locked = false,
  onChange,
  children,
}: {
  /** The field's id, by which the page's markers name it. */
  field: string;
  label: string;
  text: string | undefined;
  placeholder?: string;
  /** Whether the input would lose some of what the field holds, which leaves it to the page. */
  locked?: boolean;
  onChange: (text: string) => void;
  children?: ReactNode;
}) {
  const shownFields = useContext(ShownFields);
  const rules = useContext(RulesOf);
  const [used, setUsed] = useState(false);
  if (rules.fields !== undefined && !rules.fields.has(field)) return <>{children}</>;
  const required = rules.required.has(field);
  if (locked || (!used && !needsInput(field, text, placeholder, shownFields)))
    return (
      <>
        {children}
        {required && <Required label={label} />}
      </>
    );
  return (
    <label style={STYLE.row} onFocus={() => setUsed(true)}>
      {label}
      <TypedInput value={text ?? ""} {...requiredInput(required)} onChange={onChange} />
      {fieldStatus(text, placeholder) === "placeholder" && <Mark />}
      {required && <Required />}
    </label>
  );
}

/** The mark on a field that still holds the text it started with. */
function Mark() {
  return <small style={STYLE.mark}>placeholder</small>;
}

/**
 * The mark on a field the package requires, which cannot be emptied, saying why when pointed at;
 * with the field's label where it stands with no input beside it.
 */
function Required({ label }: { label?: string }) {
  return (
    <small style={STYLE.mark} title={REQUIRED}>
      {label === undefined ? "required" : `${label} required`}
    </small>
  );
}

/**
 * A text input whose typing becomes a command at each pause rather than at each keystroke, the
 * command carrying the whole value. Every command asks for a compile, and the compiler's own wait
 * is shorter than the gap between two keystrokes, so without this pause the page would compile for
 * most characters typed. The input shows what was typed until the command goes, and the document's
 * value after. Leaving the input sends what is pending at once, and then ends the visit to it
 * (`PanelProps.onSeal`), so that however many pauses the typing had, undo takes it back in one
 * step; the input going away drops what is pending, since its field may have gone with it.
 */
function TypedInput({
  value,
  onChange,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur"> & {
  value: string;
  onChange: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string>();
  const seal = useContext(Seal);
  const pending = useRef<{ text: string; timer: ReturnType<typeof setTimeout> }>(undefined);
  // The timer calls the latest callback, not the one from the render in which the typing began.
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(
    () => () => {
      clearTimeout(pending.current?.timer);
      pending.current = undefined;
    },
    [],
  );
  const send = () => {
    const typed = pending.current;
    if (typed === undefined) return;
    clearTimeout(typed.timer);
    pending.current = undefined;
    setDraft(undefined);
    latest.current(typed.text);
  };
  return (
    <input
      {...rest}
      value={draft ?? value}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        clearTimeout(pending.current?.timer);
        pending.current = { text, timer: setTimeout(send, PAUSE) };
      }}
      onBlur={() => {
        send();
        seal();
      }}
    />
  );
}
