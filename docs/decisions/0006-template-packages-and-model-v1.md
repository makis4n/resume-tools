# 0006. Template packages are data, and model version 1

Date: 2026-09-24 · Status: accepted

## Context

Milestone 2 item 4 settles the template package format and the first version of the resume
model. Plan section 5.1 makes the package the one artefact everything consumes, holding the
preamble, a mapping onto the canonical model and the style parameters of section 5.4, with
curated and imported packages indistinguishable. The import pipeline will produce packages and
the shared cache will store them, so a package must be data a program can check, not code. The
draft model of section 5.2 had no ids on bullets or links, one kind of list, a name it could not
split and no way to say what a section is for, all of which the three launch templates need.
RenderCV, which renders one YAML model through many LaTeX themes, is the nearest prior art.

## Decision

### Packages

A package is one JSON value, which `apps/editor/src/templates/package.ts` validates:

| Field | What it holds |
|---|---|
| `version` | `1` |
| `id` | a model id the engine also takes as a format name, since it names the template's formats and the folder a curated package lives in: it starts with a letter or digit and is not `stock` |
| `name` | the name the user sees |
| `engine` | `pdftex` or `xetex` |
| `source` | the template's `url`, `license` and `attribution`, kept as its licence asks |
| `files` | class and style files by plain file name, one segment that does not start with a dot, as text |
| `preamble` | everything before `\begin{document}`, dumped as the format |
| `controls` | the style controls the template offers, and how each is applied |
| `snippets` | how each part of the model is set with the template's macros |

A curated package is written as a folder of `template.json`, `preamble.tex` and the class files,
which item 6's loader assembles into that value; the cache and the pipeline hold only the
assembled value. A package holds no marker macros: `\rtfield` and the paragraph special from
decision 0004 are the editor's, and the generator appends them to the preamble when it dumps the
format, after the template's own preamble so that they see hyperref when it loads. The schema is
strict: every snippet must parse and use only its place's slots, as their types allow, and an
unknown key, such as a misspelt role, is an error rather than ignored. An id is unique across
every package the editor holds: curated ids are words, and milestone 3 mints imported ids from
the package's content under a prefix no curated package uses, so an import cannot take over a
curated template's format.

### The snippet language

A snippet is template text with slots, in a small language shaped like Mustache, which
`apps/editor/src/templates/snippet.ts` parses. A name is a letter followed by letters and
digits, whitespace is allowed inside the braces, and there are four tags:

- `{{name}}`, a typeset slot: the value escaped for LaTeX and wrapped in its field's markers.
- `{{&name}}`, a raw slot: the value escaped for where it goes, with no markers.
- `{{#name}}...{{/name}}`, kept when the slot is present: text that is set and not empty, a list
  with items, a date that exists.
- `{{^name}}...{{/name}}`, kept when the slot is absent.

LaTeX is full of braces, so a tag begins at the last two of a run of `{` and ends at the first
`}}` after its name: `\textbf{{{title}}}` is `\textbf{`, a slot and `}`, and
`{{{title}}}{{{dates}}}` is two arguments. Two braces that begin no well-formed tag are text, so
`{{\bf x}}` needs nothing, and a template that needs `{{` and a name as TeX text writes
`{{}{word}}`, which TeX reads the same. A block tag alone on its line, with only spaces and tabs
around it, is removed with its line, as in Mustache, so a block left out leaves no blank line
behind, which TeX would read as the end of a paragraph. A slot is never removed this way.

A slot is `text`, a plain string; `rich`, runs that may be bold, italic or links; `date`,
formatted by the generator; `url`; or `list`, the node's children, each set by its own snippet
and joined by a separator. A URL is only raw, as in `\href{{{&href}}}{{{label}}}`, since markers
would end up in the address, and raw text serves wherever else a marker would break, as in
`\href{mailto:{{&email}}}`. A list goes in typeset or names a block, never raw. User text enters
LaTeX only through slots, which the generator escapes, so keeping it from acting as LaTeX is the
generator's job and never a template's. Packages will come from other users, so the parser's cost
grows only with a snippet's length, whatever the snippet holds, and the checker does not recurse:
a crafted package can neither stall validation nor crash it.

| Snippet | Slots |
|---|---|
| `document` | `header`, `sections` (lists; the header is a list of one) |
| `header` | `first`, `last`, `headline`, `email`, `phone`, `location` (text); `links`, `contacts` (lists) |
| `contact.phone`, `.email`, `.location` | `text` (text) |
| `link.other`, and one for any other link kind | `label` (text), `href` (url) |
| `section.entries`, `.list`, `.labelled` | `title` (text); `entries` or `items` (list) |
| `section.paragraph` | `title` (text), `text` (rich) |
| `entry` | `title`, `subtitle`, `place` (text); `dates` (date); `bullets` (list) |
| `bullet`, `item` | `text` (rich) |
| `labelledItem` | `label` (text), `text` (rich) |

The body is each control's snippet followed by `document`, which runs from `\begin{document}` to
`\end{document}`. A section's snippet, and each snippet inside a section, may depend on its role:
the same snippet for every role, or a `default` and a variant for each role that needs one. Jake's
Resume sets an entry as the first block shows, and a project, on the same entry shape, with the
second block's heading in place of the first three lines:

```latex
\resumeSubheading
  {{{title}}}{{{dates}}}
  {{{subtitle}}}{{{place}}}
{{#bullets}}
\resumeItemListStart
{{bullets}}
\resumeItemListEnd
{{/bullets}}
```

```latex
\resumeProjectHeading{\textbf{{{title}}}{{#subtitle}} $|$ \emph{{{subtitle}}}{{/subtitle}}}{{{dates}}}
```

A slot language cannot put a separator only between the items that are present, so the header
has `{{contacts}}`: the phone, email and location, then the links, each set by the package's
snippet for its kind and joined by the contacts separator. A contact field without a snippet is
left out, and a link kind without one uses `other`'s. The single slots stay for templates such as
Awesome-CV, which declares each contact with its own macro. `separators` holds the text between
the items of each list slot: `sections`, `links`, `contacts`, and by role `entries`, `bullets` and
`items`. Separators have no slots, and each is a newline unless the package says otherwise.

### Style controls

A package offers any of the closed set from plan section 5.4, each with a default:

| Control | Values | Applied by |
|---|---|---|
| `pageSize` | `letter`, `a4` | a snippet for each value |
| `margins` | 0.4 to 1.0 inch in steps of 0.1 | a snippet in which `{{value}}` is, say, `0.5` |
| `fontSize` | 9 to 12 pt in half points | a snippet in which `{{value}}` is, say, `10.5` |
| `font` | one to four choices, each an id, a name and a snippet | the chosen font's snippet |
| `accent` | a colour, `#RRGGBB` | a snippet in which `{{value}}` is the six hex digits |
| `density` | `compact`, `normal`, `relaxed` | a snippet for each value |
| `dateFormat` | `MMM yyyy`, `MMMM yyyy`, `MM/yyyy`, `yyyy` | the generator, never TeX |

A control's snippet goes in the body before `\begin{document}`, so changing it costs one ordinary
compile. A control whose value the class fixes when it loads, such as the font size in `article`,
is marked `format`: its value is also a slot of the preamble, named after the control, and one
format is dumped for each combination of the format-bound values. The preamble has no other
slots, and a control's value is not a field, so it is never marked. The generator formats every
date, so every package has the date format control and may only choose its default, `MMM yyyy`
when the package says nothing. A new document starts on the package's defaults, except the page
size, which plan section 5.4 takes from the browser's locale: US Letter in the regions CLDR lists
for it, A4 everywhere else. A choice a document leaves out is the package's default.

### Model version 1

`packages/resume-model` holds the model as Zod schemas, which check structure, not content: any
text may be empty, because an edit passes through the empty string, and only ids, dates and
kinds are constrained. The objects are strict, as a package's are: a document with a field this
version does not know is refused, never read with the field dropped, so an older editor cannot
save a newer document without part of it.

```
Resume     { version: 1, header, sections: Section[] }
Header     { name: { first, last }, headline?, email?, phone?, location?, links: Link[], extras? }
Link       { id, kind, label, href }
Section    { id, kind, title, role, extras? }, and by kind
  entries    { entries: Entry[] }
  list       { items: { id, text: RichText }[] }
  labelled   { items: { id, label, text: RichText }[] }
  paragraph  { text: RichText }
Entry      { id, title, subtitle?, place?, dates?, bullets: { id, text: RichText }[], extras? }
Dates      { start, end? }: YYYY or YYYY-MM, and end may be "present"
RichText   { text, bold?, italic?, href? }[]
```

Every node a field lives on has an id of 1 to 64 letters, digits, `-` and `_`, unique across the
document, which the markers carry without escaping and which moves with its node in a reorder. A
field is named by its node's id and its own name: `header.first`, `.last`, `.headline`, `.email`,
`.phone` and `.location`; `<link>.label`; `<section>.title`, and `.text` for a paragraph;
`<entry>.title`, `.subtitle`, `.place` and `.dates`; `<bullet>.text`; `<item>.text` and
`.label`. The names are unique because node ids are, and no node has a field named like one of
the header's.

Dates are ISO 8601 at reduced precision: `YYYY-MM`, which `<input type="month">` reads and
writes, or `YYYY`. `end: "present"` means ongoing, and `start` alone is a single date, such as an
award's. The name is stored as `first` and `last`, because Awesome-CV takes two arguments and
joining is trivial where splitting is not; `last` may be empty.

A section's kind is its shape, which never changes under the user; RenderCV infers an entry's
type from its fields instead. Its role is its meaning, one of `summary`, `experience`,
`education`, `projects`, `skills`, `awards`, `publications`, `languages` and `other`, and only a
hint a package may use to pick a variant, as Jake's does for projects. A link's kind, `website`,
`linkedin`, `github`, `twitter`, `orcid` or `other`, lets AltaCV and Awesome-CV pick an icon, and
Jake's ignores it. `extras` on the header, a section or an entry keep what an imported template
has and the model lacks, never typeset until the pipeline needs them; the draft's document-wide
`extras` is gone.

### Deliberately absent

- The column a section goes in, for two-column layouts: item 20, as an addition.
- XeTeX fonts resolved to files, as decision 0003 describes: item 21, as an addition.
- Photos, skill ratings and sub-entries: kept in `extras` on import, not editable in version one.
- A sample document: it sits next to the curated package, in item 6.
- A declared page count: the product warns about a second page for every template (item 14), so
  item 7's check against the declared count becomes a check for one page.

## Consequences

- One generator renders every package: item 5 walks the model and renders the trees `snippet.ts`
  parses, from the slot lists `package.ts` exports.
- The draft model is replaced without a migration, since nothing stores documents until item 13.
- A template that snippets and controls cannot express needs a generator feature or a new
  decision record, never code in a package.
- The marker strategy that plan section 5.1 gives each package becomes one rule, that every
  typeset slot is marked, and the pipeline's probe step checks that the markers survive.
- Adding a role, a link kind, a control or a field is additive for every reader that knows it,
  and a loud refusal from one that does not; removing or renaming one needs a new version of the
  model or the package format. Strict schemas refuse a document or a package written for a newer
  editor rather than reading it wrongly.
