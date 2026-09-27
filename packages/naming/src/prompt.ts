/**
 * The naming step's prompt (milestone 3 item 9, decision 0027), all of it in this one file: what
 * the model is told of the contract (`INSTRUCTIONS`), in decision 0024's words, and how a request
 * is laid out for it (`layOut`): the template's commands by name, which a list's partner is one of,
 * the definitions the macros hand their work to, each once, then the macros one by one, each with
 * its signature, its own definition, its dependencies by name, the probe's verdict on each argument
 * and its call sites, then the preamble's settings.
 *
 * The prompt holds no LaTeX of its own: the only commands it writes are `\begin`, `\end` and the
 * names of a few macros it gives as examples, and what the model reads of a template is the
 * request's own definitions, call sites and settings. A signature goes as its arguments' kinds,
 * never as the engine printed it: a default, `O{...}`'s, is the definition's own text, which may be
 * the person's (`signatureOf`). The words the model may answer come from `answer.ts`'s lists, each
 * explained here by a record keyed by its list, so that a word added to a list and not explained
 * fails to compile, and a test checks that the text names every one. Another test pins the whole
 * prompt to `PROMPT_HASH`, beside `NAMING_VERSION`, whose meaning it is part of.
 *
 * A request too large for one call is asked in parts (`batchesOf` in `model.ts`), each laid out
 * alike: the same instructions, the same opening line and commands, and the definitions in the
 * same order, the ones most of the request's macros share first, so that a provider's cache of a
 * prompt's start serves every part.
 */

import { LINK_KINDS, SECTION_ROLES } from "@resume-tools/resume-model";
import {
  BLANKS,
  CONTACT_FIELDS,
  HOLDS,
  MACRO_KINDS,
  type MacroKind,
  MEANINGS,
  type Meaning,
  SLOTS_BY_KIND,
  STYLE_PARAMETERS,
} from "./answer.ts";
import {
  ARGUMENT_KINDS,
  type FamilyHint,
  type NamingRequest,
  type RequestDefinition,
  type RequestMacro,
  VERDICTS,
  type Verdict,
} from "./request.ts";

/** A slot of any kind. */
type SlotName = (typeof SLOTS_BY_KIND)[MacroKind][number];

/** What each kind of macro sets. */
const KIND_WORDS: Readonly<Record<MacroKind, string>> = {
  entry:
    "one entry of a section, as a job, a degree or a project, with its title, subtitle, place, dates and bullets",
  section: "a section: its heading, or its heading and what it holds",
  bullet: "one bullet of an entry, or one item of a section that is a list",
  bulletList: "a list of bullets, as the macro or environment that opens it or closes it",
  header:
    "the header or a part of it: the person's name, the headline under it, or the contacts and links together",
  contact: "one contact in the header, as an email address, a phone number or a place",
  link: "one link in the header, as a website or a profile",
  labelledItem: "an item with a label and a text, as a skill's category and what it lists",
  paragraph: "a paragraph of running text, as a summary",
  layout:
    "none of the resume's text: spacing, columns, rules, or the frame of a list that holds no text of its own",
  other:
    "what has no place above, as a photo, an icon, a chart or a bibliography, which the editor keeps as the document has it",
};

/** What each meaning of an argument is. */
const MEANING_WORDS: Readonly<Record<Meaning, string>> = {
  title: "a title: an entry's, a section's, or a part of the person's name",
  subtitle: "a subtitle, as an entry's organisation or degree",
  place: "a place",
  dates: "a date or a range of dates",
  text: "running text, as a bullet's, a contact's or a link's",
  label: "a label, as a skill's category",
  address: "where a link goes",
  icon: "an icon's name",
  colour: "a colour",
  length: "a length",
  key: "a key or an option the class reads",
  other: "anything else, and an argument that holds other units, as an entry's bullets",
};

/** What each slot holds. */
const SLOT_WORDS: Readonly<Record<SlotName, string>> = {
  title: "its title",
  subtitle: "its subtitle",
  place: "its place",
  dates: "its dates",
  bullets: "its bullets",
  entries: "its entries",
  items: "its items",
  text: "its text",
  first: "the first name",
  last: "the last name",
  headline: "the headline",
  email: "the email address",
  phone: "the phone number",
  location: "the location",
  links: "the links",
  contacts: "the contacts",
  href: "the address it links to",
  label: "its label",
};

/** What each blank is. */
const BLANK_WORDS: Readonly<Record<(typeof BLANKS)[number], string>> = {
  empty: "given, and empty",
  absent: "left out, as an optional argument can be",
  kept: "as the document's first call gives it, as an icon, a colour, a length or a key is",
};

/** What each of the probe's verdicts says of an argument (decision 0022). */
const VERDICT_WORDS: Readonly<Record<Verdict, string>> = {
  editable: "its text is set once, where it stands, as it is: the editor can mark it",
  container: "it holds other macros' calls, whose own arguments were probed",
  raw: "it holds code the editor could not read",
  breaks: "the compile stopped when it was marked",
  vanished: "its text never reached the page, as a length's, a colour's, a key's or an address's",
  twice: "its text was set twice, or went into a link or a running head as well",
  moved: "marking it moved other glyphs",
  misaligned: "its glyphs do not spell its text, as when the macro transforms it",
  case: "its glyphs spell its text in another case, as a macro that sets it in capitals does",
  split: "it began on one page and ended on another",
  untested: "the probe ran out of compiles before it",
};

/** What each kind of argument a signature has is. */
const ARGUMENT_WORDS: Readonly<Record<(typeof ARGUMENT_KINDS)[number], string>> = {
  mandatory: "an argument every call gives, in braces",
  optional:
    "an argument a call may leave out, in brackets, with a default or with none, as the signature says; a default's text is not sent",
  star: "a star, which a call gives or leaves out",
  token: "a single token, which a call gives or leaves out",
};

/** What each style parameter is. */
const PARAMETER_WORDS: Readonly<Record<(typeof STYLE_PARAMETERS)[number], string>> = {
  pageSize: "the paper's size",
  margins: "the page's margins",
  fontSize: "the base font size",
  font: "the text's font",
  accent: "the accent colour",
  density: "the spacing between lines, paragraphs or items",
};

/** Words as the text quotes them: each in backticks, in the list's order. */
const quoted = (words: readonly string[]) => words.map((word) => `\`${word}\``).join(", ");

/** A list of words and what each is, a line each, in the list's order. */
const glossed = <T extends string>(words: readonly T[], glosses: Readonly<Record<T, string>>) =>
  words.map((word) => `- \`${word}\`: ${glosses[word]}.`).join("\n");

/** Each kind's slots, a line each. */
const slotLines = MACRO_KINDS.map((kind) => {
  const slots: readonly SlotName[] = SLOTS_BY_KIND[kind];
  return slots.length === 0
    ? `- \`${kind}\`: none.`
    : `- \`${kind}\`: ${slots.map((slot) => `\`${slot}\`, ${SLOT_WORDS[slot]}`).join("; ")}.`;
}).join("\n");

/**
 * What the model is told, the same for every call: its job, what a request holds, what each field
 * of its answer means and which words it may give, and that it never writes LaTeX.
 */
export const INSTRUCTIONS = [
  "You name the macros of a LaTeX resume template, for an editor in which people edit the typeset page and never see LaTeX. An engine has compiled the template and probed it, and found which of its macros' arguments it can mark as fields: you name what it found, and never decide what is editable. Every answer is checked by compiling before anyone sees it.",
  "## What you are given",
  "First, the names of the template's commands, one of which a list's `closedBy` or `openedBy` names. Then the definitions the macros hand their work to, each once, by name, as TeX printed them, with any email address, link or phone number written as a placeholder such as <email____>. A definition that holds the person's data, as `\\@firstname` holds the first name, is named alone, with neither its text nor its length: read what it holds from its name.",
  `Then the macros and environments to answer, each under a heading that gives its \`of\`, \`command\` or \`environment\`, and its \`name\`. For each: its signature, where the engine could read it, as its arguments, numbered from 1 as TeX numbers them, a star counting, each of one of these kinds:\n${glossed(ARGUMENT_KINDS, ARGUMENT_WORDS)}\nThen how many times the document calls it; its own definition; the definitions it hands its work to, by name; what the probe found of each argument; and up to three of its calls. An environment's own definition is its \`\\begin\` code, and its \`\\end\` code is the first definition it hands its work to.`,
  "In a call, every letter of the resume's text is written `x` or `X` by its case, every digit `0`, and a date as its shape: `0000` a year, `0000-00` a month, `0000-00 -- xxxxxxx` a range that runs to the present. The names of commands and environments are kept, except a command's that the engine does not know, which is masked as the text is. You never see the resume's text: read what an argument is from its shape, the definition and the probe.",
  `What the probe found of an argument, across the document's calls:\n${glossed(VERDICTS, VERDICT_WORDS)}\nWhere the calls with the argument empty came to another verdict than the others, that is said too, and an argument no call gave says so.`,
  "Last, the class's name and options and the preamble's settings, numbered from 0, masked as the calls are but for numbers, lengths, colours and known keywords; or a line that says they are asked in another part of the request.",
  "## What you answer",
  "`macros`: an answer for each macro and environment asked, with its `of` and `name` exactly as its heading gives them, and for nothing else; and `preamble`.",
  `\`kind\`: what the macro sets.\n${glossed(MACRO_KINDS, KIND_WORDS)}`,
  `\`arguments\`: the arguments you name, by their \`index\`, in the signature's order, each once; leave out an argument you have nothing to say of. Each has a \`meaning\`:\n${glossed(MEANINGS, MEANING_WORDS)}`,
  `\`slot\`: the slot of its kind an argument fills, where it fills one, each slot filled by one argument at most:\n${slotLines}\nAn argument that is not the resume's text, an icon, a colour, a length or a key, fills no slot, and an address fills only a contact's or a link's \`href\`. The parts of the person's name are titles, which fill the header's \`first\` and \`last\`. An argument that holds other units, as an entry's bullets or the header's contacts, means \`other\` and fills the slot of what it holds.`,
  "`parts`: an argument that holds two paragraphs of text or more, as Jake's Resume's projects heading holds a title and a subtitle either side of a rule, lists them in order, each with its `meaning` and `slot`, and fills no slot itself.",
  `\`blank\`: what the argument is in a blank unit, one the user adds:\n${glossed(BLANKS, BLANK_WORDS)}`,
  "`repeatable`: whether the unit is one the user may add and remove, as an entry, a bullet, a section, a link or a labelled item is. `omitWhenBlank`: whether a blank unit is left off the page, as a tag whose empty frame would show.",
  `\`list\`: for a macro that opens a list or closes one. The macro that opens it says \`does\` \`opens\`, the macro that closes it under \`closedBy\`, and what the list \`holds\`, one of ${quoted(HOLDS)}; the macro that closes it says \`does\` \`closes\` and the macro that opened it under \`openedBy\`, and nothing else. Each is one of the template's commands, named exactly as the request's list of them gives it, and never anything else. Jake's Resume's \`\\resumeItemListStart\` opens a list of bullets that \`\\resumeItemListEnd\` closes. An environment that holds a list opens it, and its own end closes it, so it names no \`closedBy\`.`,
  `\`role\`: the section role the macro's meaning implies, where it implies one, as a projects heading or an awards table says its section's by what it is: one of ${quoted(SECTION_ROLES)}. Leave it out where the macro would serve any section.`,
  `\`contact\`: for a \`contact\`, the header's field it sets, one of ${quoted(CONTACT_FIELDS)}. \`link\`: for a \`link\`, its kind, which picks its icon, one of ${quoted(LINK_KINDS)}.`,
  "`variants`: another mapping of the arguments in sections of one role, as Jake's Resume's `\\resumeSubheading` swaps an entry's dates and place in its education section: the role, and the arguments as they read there.",
  `\`preamble\`: its \`parameters\`, the style parameters the settings set, each once:\n${glossed(STYLE_PARAMETERS, PARAMETER_WORDS)}\nEach names the \`setting\` that sets it by its number, or none where the class's options set it; the \`command\`, without its backslash, as \`geometry\`, \`usepackage\`, \`documentclass\` or \`definecolor\`; and the \`key\`, the option or the name inside it, as \`margin\`, \`11pt\` or a colour's name: a plain name, of letters, digits, \`@\`, dots, hyphens and underscores, left out where the name has anything else, as a font's name with spaces has. Name only what a setting plainly sets. When the settings are asked in another part, answer an empty list.`,
  "## What you never do",
  "You never write LaTeX. A macro that defeats the editor's markers may be given a redefinition: LaTeX a person wrote, applied after the document class, that redefines the template's macro by its name and keeps upstream's output, the page exactly as the original template sets it. A redefinition is a person's to write and to review, never yours, and your answer has no place for one: never invent LaTeX, a redefinition, a snippet or anything else that would change upstream's output. Nor do you guess the resume's text, which you have not seen.",
  "When you cannot tell what a macro sets, answer `other` with no slots: the editor then keeps it as the document has it, which is always safe, where a wrong slot would put the wrong text in the wrong place.",
].join("\n\n");

/** What the pieces of a laid-out request are joined with. */
const SEPARATOR = "\n\n";

/** The families' names, as the opening line gives them. */
const FAMILY_NAMES: Readonly<Record<FamilyHint, string>> = {
  jake: "Jake's Resume",
  "awesome-cv": "Awesome-CV",
  altacv: "AltaCV",
  moderncv: "moderncv",
  europecv: "europecv",
};

/** The opening line: the engine, and the family the template says it is. */
function opening(request: NamingRequest): string {
  const engine = request.engine === "xetex" ? "XeTeX" : "pdfTeX";
  const family =
    request.family === undefined
      ? ""
      : `, which its class or its macros say is ${FAMILY_NAMES[request.family]} or a fork of it`;
  return `A template for the ${engine} engine${family}.`;
}

/** The heading of the definitions the macros hand their work to. */
const DEFINITIONS_HEADING = "## The definitions the macros below hand their work to, each once";

/** The heading of the macros to answer. */
const MACROS_HEADING =
  "## The macros and environments to answer, each under a heading that gives its of and its name";

/**
 * The line that names the template's commands, one of which a list's partner is (decision 0024),
 * the same in every part of a request; none for a request of no command.
 */
function commandsLine(commands: readonly string[]): string | undefined {
  if (commands.length === 0) return undefined;
  return `The template's commands, one of which a list's \`closedBy\` or \`openedBy\` names: ${commands.map((name) => `"${name}"`).join(", ")}.`;
}

/** A definition as it is laid out: its name, and its text, or that it holds the person's data. */
function definitionOf(definition: RequestDefinition): string {
  return definition.kind === "data"
    ? `Definition "${definition.name}": holds the person's data, which is not sent.`
    : `Definition "${definition.name}":\n${definition.text}`;
}

/** How many times, in words a count reads well in. */
const times = (count: number) => (count === 1 ? "once" : count === 2 ? "twice" : `${count} times`);

/** A call's argument as it is laid out: in the delimiters its kind has, or that it is not given. */
function argumentText(
  text: string | null,
  kind: RequestMacro["arguments"][number]["kind"] | undefined,
) {
  if (text === null) return "not given";
  return kind === "mandatory" ? `{${text}}` : kind === "optional" ? `[${text}]` : text;
}

/**
 * Whether each argument an xparse signature reads has a default, in order, or undefined for a
 * signature of letters the editor reads no argument of: `O{...}`, `D<>{...}`, `R<>{...}` and
 * `G{...}` have one; `m`, `o`, `s`, `t`, `r`, `d` and `g` none; and a processor, `>{...}` or
 * `={...}`, and the prefixes `+` and `!` are no argument. What a default holds is never read, let
 * alone kept: it is the definition's own text, which may be the person's. A delimiter is one token,
 * a character, a command's name or a brace group.
 */
function defaultsOf(spec: string): boolean[] | undefined {
  const found: boolean[] = [];
  let at = 0;
  const spaces = () => {
    while (at < spec.length && /\s/.test(spec[at] ?? "")) at++;
  };
  /** A brace group passed over, `at` past its close; false where none opens or none closes. */
  const group = (): boolean => {
    spaces();
    if (spec[at] !== "{") return false;
    let depth = 0;
    for (let i = at; i < spec.length; i++) {
      const char = spec[i];
      if (char === "\\") i++;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        at = i + 1;
        return true;
      }
    }
    return false;
  };
  /** One token passed over: a brace group, a command's name, or a character. */
  const token = (): boolean => {
    spaces();
    if (at >= spec.length) return false;
    if (spec[at] === "{") return group();
    const name = /^\\(?:[A-Za-z@]+|[^])/u.exec(spec.slice(at))?.[0];
    at += name?.length ?? String.fromCodePoint(spec.codePointAt(at) ?? 0).length;
    return true;
  };
  for (spaces(); at < spec.length; spaces()) {
    const type = spec[at++] ?? "";
    let read = true;
    if (/^[mostg]$/.test(type)) {
      if (type === "t") read = token();
      found.push(false);
    } else if (type === "O" || type === "G") {
      read = group();
      found.push(true);
    } else if (type === "r" || type === "d") {
      read = token() && token();
      found.push(false);
    } else if (type === "R" || type === "D") {
      read = token() && token() && group();
      found.push(true);
    } else if (type === ">" || type === "=") read = group();
    else if (type !== "+" && type !== "!") return undefined;
    if (!read) return undefined;
  }
  return found;
}

/**
 * A macro's signature as it is laid out: each argument by its index and its kind, as the request
 * lists them, and whether an optional one has a default; never the signature as the engine printed
 * it, whose defaults are the definition's text (`defaultsOf`).
 */
function signatureOf(macro: RequestMacro): string {
  if (macro.signature === undefined) return "Signature: the engine could not read one.";
  if (macro.arguments.length === 0)
    return macro.signature.trim() === ""
      ? "Signature: it takes no arguments."
      : "Signature: it takes arguments the editor does not read, and its calls show none.";
  const defaults = defaultsOf(macro.signature);
  const known = defaults?.length === macro.arguments.length ? defaults : undefined;
  const kinds = macro.arguments.map((argument, i) => {
    const kind = `#${argument.index} ${argument.kind}`;
    const given = known?.[i];
    if (argument.kind !== "optional" || given === undefined) return kind;
    return `${kind} with ${given ? "a default" : "no default"}`;
  });
  return `Signature: ${kinds.join(", ")}.`;
}

/**
 * A macro as it is laid out: its heading, which gives its `of` and `name` as the answer gives them,
 * its signature's arguments, how often the document calls it, its own definition, its dependencies
 * by name, the probe's verdict on each argument, and its call sites.
 */
function macroOf(macro: RequestMacro, own: RequestDefinition | undefined): string {
  const environment = macro.of === "environment";
  const lines = [`### ${macro.of} "${macro.name}"`];
  lines.push(signatureOf(macro));
  lines.push(
    macro.calls === 0
      ? "The document does not call it: it is asked as the class defines it."
      : `The document ${environment ? "opens" : "calls"} it ${times(macro.calls)}.`,
  );
  lines.push(environment ? "Its own definition, its begin code:" : "Its own definition:");
  lines.push(own?.kind === "definition" ? own.text : "none was sent.");
  const [first] = macro.dependencies;
  lines.push(
    first === undefined
      ? "It hands its work to no other definition."
      : `It hands its work to ${macro.dependencies.map((name) => `"${name}"`).join(", ")}${environment && first === `end${macro.name}` ? `, the first its end code` : ""}.`,
  );
  if (macro.capped)
    lines.push("Its closure stopped at its cap: it hands its work to more than these.");
  if (macro.arguments.length > 0) lines.push("What the probe found of each argument:");
  for (const argument of macro.arguments)
    lines.push(
      `#${argument.index}, ${argument.kind}: ${argument.verdict ?? "no call gave it"}${argument.empty === undefined ? "" : `; its empty calls: ${argument.empty}`}`,
    );
  macro.sites.forEach((site, s) => {
    // A call that gives no argument and opens no body says nothing the heading has not.
    if (site.arguments.length === 0 && site.body === undefined) return;
    lines.push(`Call ${s + 1}:`);
    site.arguments.forEach((text, a) => {
      lines.push(`#${a + 1} ${argumentText(text, macro.arguments[a]?.kind)}`);
    });
    if (site.body !== undefined) lines.push(`Its body begins: ${site.body}`);
  });
  return lines.join("\n");
}

/** The preamble as it is laid out: the class and the settings, or that another part asks them. */
function preambleOf(request: NamingRequest, asked: boolean): string {
  if (!asked)
    return "## The preamble\nIts settings are asked in another part of this request: answer `parameters` as an empty list.";
  const lines = ["## The preamble's settings, numbered from 0"];
  const documentClass = request.preamble.class;
  lines.push(
    documentClass === undefined
      ? "The class: none was found."
      : `The class: "${documentClass.name}", ${documentClass.options.length === 0 ? "with no options" : `with the options ${documentClass.options.join(", ")}`}.`,
  );
  if (request.preamble.settings.length === 0) lines.push("No settings.");
  request.preamble.settings.forEach((setting, i) => {
    lines.push(`[${i}] ${setting}`);
  });
  return lines.join("\n");
}

/** The macros a request asks about: those with a key; a macro that holds data is never answered. */
export function askedOf(request: Pick<NamingRequest, "macros">): RequestMacro[] {
  return request.macros.filter((macro) => macro.key !== undefined);
}

/**
 * The commands a list's answer may name as its partner, each once: the request's own that have a
 * key, in its order, then those the caller adds (`NameOptions.partners`), a document's commands its
 * request leaves out since the cache answered them. A partner is a command, never an environment,
 * whose own `\end` closes it (decision 0024).
 */
export function commandsOf(
  request: Pick<NamingRequest, "macros">,
  partners: readonly string[] = [],
): string[] {
  const own = askedOf(request).filter((macro) => macro.of === "command");
  return [...new Set([...own.map((macro) => macro.name), ...partners])];
}

/**
 * The order a request's definitions are laid out in: the ones most of its asked macros hand their
 * work to first, then as the request lists them. Every part of a request laid out with the same
 * order starts the same way, so that a provider's cache of a prompt's start serves each.
 */
export function definitionOrder(request: NamingRequest): Map<string, number> {
  const uses = new Map<string, number>();
  for (const macro of askedOf(request))
    for (const name of new Set(macro.dependencies)) uses.set(name, (uses.get(name) ?? 0) + 1);
  const ranked = request.definitions
    .map((definition, i) => ({ name: definition.name, uses: uses.get(definition.name) ?? 0, i }))
    .sort((a, b) => b.uses - a.uses || a.i - b.i);
  return new Map(ranked.map((each, rank) => [each.name, rank]));
}

/** How a request is laid out: whether it asks the preamble, and the order of its definitions. */
export interface LayOutOptions {
  /** Whether this part asks the preamble's settings; the first part of a request does. */
  preamble?: boolean;
  /** The definitions' order, the whole request's (`definitionOrder`), for a part of it. */
  order?: ReadonlyMap<string, number>;
  /** The commands a list's partner may be, the whole request's (`commandsOf`), for a part of it. */
  commands?: readonly string[];
}

/**
 * The definitions a request lays out apart from its macros: those its asked macros hand their work
 * to that are not themselves asked, whose own definitions their headings hold.
 */
function sharedOf(request: NamingRequest, order: ReadonlyMap<string, number>) {
  const asked = askedOf(request);
  const own = new Set(asked.map((macro) => macro.name));
  const needed = new Set(asked.flatMap((macro) => macro.dependencies));
  return request.definitions
    .filter((definition) => needed.has(definition.name) && !own.has(definition.name))
    .sort(
      (a, b) =>
        (order.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.name) ?? Number.MAX_SAFE_INTEGER),
    );
}

/**
 * The user's text for a request, or a part of one: the opening line, the template's commands by
 * name, the definitions its macros hand their work to, each once, the macros and environments it
 * asks, one by one, and the preamble's settings, or a line that says another part asks them.
 */
export function layOut(request: NamingRequest, options: LayOutOptions = {}): string {
  const order = options.order ?? definitionOrder(request);
  const definitions = new Map(request.definitions.map((each) => [each.name, each]));
  const commands = commandsLine(options.commands ?? commandsOf(request));
  return [
    opening(request),
    ...(commands === undefined ? [] : [commands]),
    DEFINITIONS_HEADING,
    ...sharedOf(request, order).map(definitionOf),
    MACROS_HEADING,
    ...askedOf(request).map((macro) => macroOf(macro, definitions.get(macro.name))),
    preambleOf(request, options.preamble ?? true),
  ].join(SEPARATOR);
}

/**
 * The sizes of a request's pieces as `layOut` lays them out, in characters, each with the separator
 * before it, so that a part's prompt can be sized before it is laid out: what every part holds,
 * the instructions and the commands a partner may be among it (`fixed`), a macro's own piece
 * (`macro`) and a shared definition's (`definition`). A part's prompt is `fixed` and the pieces it
 * holds, exactly, laid out with the same `commands`.
 */
export function measure(request: NamingRequest, commands: readonly string[] = commandsOf(request)) {
  const definitions = new Map(request.definitions.map((each) => [each.name, each]));
  const line = commandsLine(commands);
  const fixed = (preamble: boolean) =>
    INSTRUCTIONS.length +
    opening(request).length +
    (line === undefined ? 0 : line.length + SEPARATOR.length) +
    DEFINITIONS_HEADING.length +
    MACROS_HEADING.length +
    preambleOf(request, preamble).length +
    3 * SEPARATOR.length;
  const definition = (name: string) => {
    const found = definitions.get(name);
    return found === undefined ? 0 : definitionOf(found).length + SEPARATOR.length;
  };
  const macro = (asked: RequestMacro) =>
    macroOf(asked, definitions.get(asked.name)).length + SEPARATOR.length;
  return { fixed, definition, macro };
}

/** The most problems a retry quotes back. */
const QUOTED_PROBLEMS = 40;

/** What the model is told after an answer that did not validate: its problems, and to answer again. */
export function retryText(problems: readonly string[]): string {
  const shown = problems.slice(0, QUOTED_PROBLEMS);
  return [
    "Your answer did not validate. Its problems:",
    ...shown.map((problem) => `- ${problem}`),
    ...(problems.length > shown.length ? [`- and ${problems.length - shown.length} more`] : []),
    "Answer again, the whole answer, for every macro and environment asked, with these put right.",
  ].join("\n");
}
