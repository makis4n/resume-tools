/**
 * Arguments of commands that packages define in ways their meaning does not show (milestone 3
 * item 4, decision 0020), which `signatures.ts` takes before what it reads from the meaning.
 *
 * ulem's underlines test for mathematics first and hand their argument on from inside a
 * conditional; soul's commands scan their argument token by token; ifthen's `\ifthenelse` takes
 * its test and leaves its two branches to `\@firstoftwo` or `\@secondoftwo`; pifont's `\ding` is
 * `\Pisymbol {pzd}`, which the reading of a meaning's tail finds too. Each command is known by its
 * name and by a mark its meaning holds when the package defined it, so that a document's own
 * command of the same name is read from its own meaning. twoopt's commands, whatever their names,
 * are known by the shape `\newcommandtwoopt` gives them.
 */

/** A package's command, what arguments it takes, and a mark of the package's definition. */
interface PackageCommand {
  package: string;
  /** Its arguments, in xparse's syntax. */
  spec: string;
  /** What its meaning, as the compile prints it, holds when the package defined it. */
  mark: RegExp;
}

const UNDERLINE = /\\UL(?:set|on) /;

const COMMANDS: ReadonlyMap<string, PackageCommand> = new Map([
  ["ifthenelse", { package: "ifthen", spec: "m m m", mark: /\\TE@/ }],
  ...["uline", "uuline", "uwave", "sout", "xout", "dashuline", "dotuline"].map(
    (name) => [name, { package: "ulem", spec: "m", mark: UNDERLINE }] as const,
  ),
  ["ding", { package: "pifont", spec: "m", mark: /\\Pisymbol \{pzd\}/ }],
  ...["so", "ul", "st", "hl", "caps"].flatMap((name) => {
    // soul's `\so` is `\textso`, a robust command whose meaning names itself.
    const known = { package: "soul", spec: "m", mark: new RegExp(`\\\\text${name} `) };
    return [[name, known] as const, [`text${name}`, known] as const];
  }),
]);

/**
 * The arguments a package's command takes, when `name` is one of those above and its meaning,
 * as the compile prints it, is the package's.
 */
export function packageSignature(
  name: string,
  meaning: string,
): { spec: string; package: string } | undefined {
  const known = COMMANDS.get(name);
  return known !== undefined && known.mark.test(meaning)
    ? { spec: known.spec, package: known.package }
    : undefined;
}

/**
 * The second macro twoopt's `\newcommandtwoopt{\x}[n][a][b]{...}` makes: `\\x` takes the first
 * optional argument, as `\newcommand`'s does, then scans for a second, and hands both to `\2\x`,
 * which takes the n arguments in all.
 */
const TWOOPT = /^\\to@ScanSecondOptArg \\(2\\\S+) \{#1\}\{.*\}$/s;

/**
 * A twoopt command's arguments from its second macro's replacement text, `\\x`'s: two optional
 * ones and the rest of `\2\x`'s parameters mandatory. `meaningOf` gives what the compile printed
 * of a name. Undefined for a replacement of any other shape, or when `\2\x` cannot be read.
 */
export function twooptSpec(
  replacement: string,
  meaningOf: (name: string) => string | undefined,
): string | undefined {
  const shape = TWOOPT.exec(replacement);
  const inner = shape === null ? undefined : meaningOf(shape[1] ?? "");
  const parameters = inner === undefined ? null : /^(?:\\long )?macro:((?:#\d)*)->/.exec(inner);
  if (parameters === null) return undefined;
  const count = (parameters[1] ?? "").length / 2;
  if (count < 2) return undefined;
  return ["o", "o", ...Array.from({ length: count - 2 }, () => "m")].join(" ");
}
