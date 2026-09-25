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
import { type DrawnPage, fieldsShown } from "../page/draw";
import { curated } from "../templates/curated";
import { formatDates } from "../templates/dates";
import { isBlank } from "../templates/escape";
import { type DateFormat, defaultControls } from "../templates/package";
import {
  type Command,
  type Document,
  fieldsOf,
  PLACEHOLDERS,
  SECTION_TITLES,
  type StructureOp,
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
  }
}

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

export interface PanelProps {
  document: Document;
  /**
   * The fields that count as shown on the page (`shownFieldsOf`), so that a filled field the page
   * does not show gets an input here; undefined before the first page.
   */
  shownFields?: ReadonlySet<string>;
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

export function Panel({ document, shownFields, onCommand, onSeal }: PanelProps) {
  const { header, sections } = document.resume;
  return (
    <ShownFields value={shownFields}>
      <Seal value={onSeal}>
        <div style={STYLE.panel}>
          <HeaderFields header={header} send={onCommand} />
          <Links links={header.links} send={onCommand} />
          <Sections sections={sections} format={dateFormatOf(document)} send={onCommand} />
        </div>
      </Seal>
    </ShownFields>
  );
}

/** The date format the page sets dates in: the document's choice, or its template's default. */
function dateFormatOf(document: Document): DateFormat {
  const { dateFormat } = document.controls;
  return dateFormat ?? defaultControls(curated(document.template).package).dateFormat;
}

/** The `setHeader` op for one of the header's fields. */
function setHeader(key: (typeof HEADER_FIELDS)[number]["key"], text: string): StructureOp {
  const op: Extract<StructureOp, { op: "setHeader" }> = { op: "setHeader" };
  op[key] = text;
  return op;
}

function HeaderFields({ header, send }: { header: Header; send: Send }) {
  return (
    <fieldset>
      <legend>Header</legend>
      <FieldInput
        label="First name"
        text={header.name.first}
        {...textField("header.first", send)}
      />
      <FieldInput label="Last name" text={header.name.last} {...textField("header.last", send)} />
      {HEADER_FIELDS.map(({ key, label, mode }) => (
        <label key={key} style={STYLE.row}>
          {label}
          <TypedInput
            value={header[key] ?? ""}
            inputMode={mode}
            onChange={(value) => send(structural(setHeader(key, value)), `header:${key}`)}
          />
        </label>
      ))}
    </fieldset>
  );
}

function Links({ links, send }: { links: readonly Link[]; send: Send }) {
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
                  onChange={(label) => set(link.id, { label }, `field:${link.id}.label`)}
                />
                {fieldStatus(link.label, PLACEHOLDERS.link.label) === "placeholder" && <Mark />}
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
              />
            </li>
          ))}
        </ol>
      )}
      <button type="button" onClick={() => send(structural({ op: "addLink" }))}>
        Add link
      </button>
    </fieldset>
  );
}

function Sections({
  sections,
  format,
  send,
}: {
  sections: readonly Section[];
  format: DateFormat;
  send: Send;
}) {
  return (
    <fieldset>
      <legend>Sections</legend>
      {sections.length > 0 && (
        <ol style={STYLE.list}>
          {sections.map((section, index) => (
            <SectionRow
              key={section.id}
              section={section}
              index={index}
              count={sections.length}
              format={format}
              send={send}
            />
          ))}
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
  send,
}: {
  section: Section;
  index: number;
  count: number;
  format: DateFormat;
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
        />
      </div>
      <FieldInput label="Title" text={title} {...textField(`${id}.title`, send)} />
      {open && <SectionContents section={section} format={format} send={send} />}
    </li>
  );
}

/** What a section holds, each with the buttons that reorder and remove it, and one to add more. */
function SectionContents({
  section,
  format,
  send,
}: {
  section: Section;
  format: DateFormat;
  send: Send;
}) {
  switch (section.kind) {
    case "entries": {
      const { entries } = section;
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
                  send={send}
                />
              ))}
            </ol>
          )}
          <button
            type="button"
            onClick={() => send(structural({ op: "addEntry", section: section.id }))}
          >
            Add entry
          </button>
        </>
      );
    }
    case "list":
    case "labelled": {
      const items: readonly (Item | LabelledItem)[] = section.items;
      return (
        <>
          {items.length > 0 && (
            <ol style={STYLE.list}>
              {items.map((item, index) => (
                <ItemRow key={item.id} item={item} index={index} count={items.length} send={send} />
              ))}
            </ol>
          )}
          <button
            type="button"
            onClick={() => send(structural({ op: "addItem", section: section.id }))}
          >
            Add item
          </button>
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
 * it has none on the page to click.
 */
function EntryRow({
  entry,
  index,
  count,
  format,
  send,
}: {
  entry: Entry;
  index: number;
  count: number;
  format: DateFormat;
  send: Send;
}) {
  const { id, bullets } = entry;
  const placeholder = PLACEHOLDERS.entry;
  return (
    <li>
      <div style={STYLE.row}>
        <span>{isBlank(entry.title) ? "Untitled entry" : entry.title}</span>
        {entry.dates ? (
          <span>{formatDates(entry.dates, format)}</span>
        ) : (
          <button
            type="button"
            onClick={() =>
              send({ type: "dates", field: `${id}.dates`, dates: { start: thisMonth() } })
            }
          >
            Add dates
          </button>
        )}
        <Reorder
          index={index}
          count={count}
          onMove={(to) => send(structural({ op: "moveEntry", id, to }))}
          onRemove={() => send(structural({ op: "removeEntry", id }))}
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
        <button type="button" onClick={() => send(structural({ op: "addBullet", entry: id }))}>
          Add bullet
        </button>
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
  send,
}: {
  item: Item | LabelledItem;
  index: number;
  count: number;
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
      />
    </li>
  );
}

/** The kind and role of a new section, and the button that adds it at the end. */
function AddSection({ send }: { send: Send }) {
  const [kind, setKind] = useState<SectionKind>("entries");
  const [role, setRole] = useState<SectionRole>("experience");
  return (
    <div style={STYLE.row}>
      <label style={STYLE.row}>
        Kind
        <select value={kind} onChange={(event) => setKind(SectionKind.parse(event.target.value))}>
          {SECTION_KINDS.map((each) => (
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

/** Move up, move down and remove, for the node at `index` of the `count` in its list. */
function Reorder({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  return (
    <span style={STYLE.row}>
      <button
        type="button"
        title="Move up"
        aria-label="Move up"
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        ↑
      </button>
      <button
        type="button"
        title="Move down"
        aria-label="Move down"
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        ↓
      </button>
      <button type="button" onClick={onRemove}>
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
 * below it, from under the pointer.
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
  const [used, setUsed] = useState(false);
  if (locked || (!used && !needsInput(field, text, placeholder, shownFields)))
    return <>{children}</>;
  return (
    <label style={STYLE.row} onFocus={() => setUsed(true)}>
      {label}
      <TypedInput value={text ?? ""} onChange={onChange} />
      {fieldStatus(text, placeholder) === "placeholder" && <Mark />}
    </label>
  );
}

/** The mark on a field that still holds the text it started with. */
function Mark() {
  return <small style={STYLE.mark}>placeholder</small>;
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
