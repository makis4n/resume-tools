import {
  Bullet,
  Entry,
  Header,
  Item,
  LabelledItem,
  Link,
  SECTION_KINDS,
  Section,
} from "@resume-tools/resume-model";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  BULLET_SLOTS,
  controlValuesFor,
  defaultControls,
  ENTRY_SLOTS,
  fontFeatures,
  fontFiles,
  HEADER_SLOTS,
  ITEM_SLOTS,
  LABELLED_ITEM_SLOTS,
  LINK_SLOTS,
  pageSizeFor,
  parsePackage,
  SECTION_SLOTS,
  TemplatePackage,
} from "./package";

type PackageInput = z.input<typeof TemplatePackage>;

/** The least a package needs, on `article`, invented for these tests. */
const plain: PackageInput = {
  version: 1,
  id: "plain",
  name: "Plain",
  engine: "pdftex",
  source: { url: "https://example.com/plain", license: "MIT", attribution: "Invented for tests" },
  preamble: "\\documentclass[11pt]{article}\n\\usepackage[hidelinks]{hyperref}",
  controls: {},
  snippets: {
    document: "\\begin{document}\n{{header}}\n{{sections}}\n\\end{document}",
    header: "\\begin{center}\n{\\Large {{first}} {{last}}}\\\\\n{{contacts}}\n\\end{center}",
    link: { other: "\\href{{{&href}}}{{{label}}}" },
    section: {
      entries: "\\section*{{{title}}}\n{{entries}}",
      list: "\\section*{{{title}}}\n{{items}}",
      labelled: "\\section*{{{title}}}\n{{items}}",
      paragraph: "\\section*{{{title}}}\n{{text}}",
    },
    entry: [
      "\\textbf{{{title}}}{{#dates}} \\hfill {{dates}}{{/dates}}",
      "{{#bullets}}",
      "\\begin{itemize}",
      "{{bullets}}",
      "\\end{itemize}",
      "{{/bullets}}",
    ].join("\n"),
    bullet: "\\item {{text}}",
    item: "{{text}}\\par",
    labelledItem: "\\textbf{{{label}}}: {{text}}\\par",
  },
};

/** The plain package with one change. */
function plainWith(change: (pkg: PackageInput) => void): PackageInput {
  const pkg = structuredClone(plain);
  change(pkg);
  return pkg;
}

/** What is wrong with a package, as paths and messages. */
const issues = (value: unknown) =>
  TemplatePackage.safeParse(value).error?.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  })) ?? [];

const withFonts = (defaultFont: string, ...ids: string[]) =>
  plainWith((pkg) => {
    const apply = "\\renewcommand{\\familydefault}{\\sfdefault}";
    pkg.controls.font = {
      default: defaultFont,
      choices: ids.map((id) => ({ id, name: id, apply })),
    };
  });

describe("TemplatePackage", () => {
  it("parses a minimal package, filling in its files and separators", () => {
    const pkg = parsePackage(plain);
    expect(pkg.files).toEqual({});
    expect(pkg.snippets.separators).toEqual({
      sections: "\n",
      links: "\n",
      contacts: "\n",
      entries: "\n",
      bullets: "\n",
      items: "\n",
    });
  });

  it("checks every role's variant of a snippet against the snippet's slots", () => {
    const pkg = plainWith((pkg) => {
      pkg.snippets.entry = { default: "{{title}}", projects: "{{title}} $|$ {{stack}}" };
    });
    expect(issues(pkg)).toEqual([
      {
        path: "snippets.entry.projects",
        message:
          "there is no slot stack here; the slots are title, subtitle, place, dates, bullets",
      },
    ]);
  });

  it("refuses a key it does not know, such as a misspelt role", () => {
    const pkg = plainWith((pkg) => {
      Object.assign(pkg.snippets, { entry: { default: "{{title}}", project: "{{title}}" } });
    });
    expect(issues(pkg)).toEqual([
      { path: "snippets.entry", message: 'Unrecognized key: "project"' },
    ]);
  });

  it("reports a snippet that does not parse once, at its own path", () => {
    const pkg = plainWith((pkg) => {
      pkg.snippets.bullet = "\\item {{#text}}{{text}}";
    });
    expect(issues(pkg)).toEqual([
      { path: "snippets.bullet", message: "{{#text}} at offset 6 is never closed" },
    ]);
  });

  it("offers the preamble a slot for each format-bound control, and no others", () => {
    const sized = (fontSize: PackageInput["controls"]["fontSize"]) =>
      plainWith((pkg) => {
        pkg.preamble = "\\documentclass[{{fontSize}}pt]{article}";
        pkg.controls.fontSize = fontSize;
      });
    expect(issues(sized({ default: 11, apply: "", format: true }))).toEqual([]);
    expect(issues(sized({ default: 11, apply: "" }))).toEqual([
      { path: "preamble", message: "there is no slot fontSize here; this snippet has none" },
    ]);
  });

  it("needs a link's address raw", () => {
    const linked = (other: string) =>
      plainWith((pkg) => {
        pkg.snippets.link = { other };
      });
    expect(issues(linked("\\href{{{href}}}{{{label}}}"))).toEqual([
      { path: "snippets.link.other", message: "href is a URL, so it goes in raw, as {{&href}}" },
    ]);
    expect(issues(linked("\\href{{{&href}}}{{{label}}}"))).toEqual([]);
  });

  it("puts only a URL slot in an address, since escaped text breaks inside \\href", () => {
    const emailed = (email: string) =>
      plainWith((pkg) => {
        pkg.snippets.contact = { email };
      });
    const path = "snippets.contact.email";
    expect(issues(emailed("\\href{mailto:{{&text}}}{{{text}}}"))).toEqual([
      { path, message: "text is a text slot; inside \\href use a url slot, such as href" },
    ]);
    expect(issues(emailed("\\href{{{&href}}}{{{text}}}"))).toEqual([]);
    // A typeset URL is refused by the rule for URLs, as before, and by nothing else.
    expect(issues(emailed("\\href{{{href}}}{{{text}}}"))).toEqual([
      { path, message: "href is a URL, so it goes in raw, as {{&href}}" },
    ]);
    // The check runs wherever snippets are checked, a control's among them.
    const accented = plainWith((pkg) => {
      pkg.controls.accent = { default: "#1F4E79", apply: "\\url{{{&value}}}" };
    });
    expect(issues(accented)).toEqual([
      {
        path: "controls.accent.apply",
        message: "value is a text slot; inside \\url use a url slot, such as href",
      },
    ]);
  });

  it("holds margins to tenths of an inch and font sizes to half points", () => {
    const stepped = (margins: number, fontSize: number) =>
      plainWith((pkg) => {
        pkg.controls.margins = { default: margins, apply: "\\geometry{margin={{value}}in}" };
        pkg.controls.fontSize = { default: fontSize, apply: "\\fontsize{{{value}}pt}{1.2em}" };
      });
    expect(issues(stepped(0.5, 10.5))).toEqual([]);
    expect(issues(stepped(0.7, 9))).toEqual([]);
    expect(issues(stepped(0.45, 9.25)).map((issue) => issue.path)).toEqual([
      "controls.margins.default",
      "controls.fontSize.default",
    ]);
  });

  it("needs the default font among the choices, each with an id of its own", () => {
    expect(issues(withFonts("serif", "serif", "sans"))).toEqual([]);
    expect(issues(withFonts("mono", "serif", "sans"))).toEqual([
      { path: "controls.font.default", message: "the default font mono is not one of the choices" },
    ]);
    expect(issues(withFonts("serif", "serif", "serif"))).toEqual([
      {
        path: "controls.font.choices.1.id",
        message: "the font id serif is already used by another choice",
      },
    ]);
  });

  it("needs the accent colour as #RRGGBB", () => {
    const accented = (colour: string) =>
      plainWith((pkg) => {
        pkg.controls.accent = { default: colour, apply: "\\definecolor{accent}{HTML}{{{value}}}" };
      });
    expect(issues(accented("#1F4E79"))).toEqual([]);
    expect(issues(accented("red"))).toEqual([
      { path: "controls.accent.default", message: "a colour is #RRGGBB" },
    ]);
  });
});

describe("defaultControls", () => {
  it("starts a document on the package's defaults, with a date format", () => {
    const pkg = plainWith((pkg) => {
      pkg.controls = {
        pageSize: { default: "a4", apply: { letter: "\\geometry{letterpaper}", a4: "" } },
        density: { default: "normal", apply: { compact: "", normal: "", relaxed: "" } },
      };
    });
    expect(defaultControls(parsePackage(pkg))).toEqual({
      pageSize: "a4",
      density: "normal",
      dateFormat: "MMM yyyy",
    });
    const dated = plainWith((pkg) => {
      pkg.controls = { dateFormat: { default: "MM/yyyy" } };
    });
    expect(defaultControls(parsePackage(dated))).toEqual({ dateFormat: "MM/yyyy" });
  });
});

describe("controlValuesFor", () => {
  it("refuses a choice for a control the package lacks, and a font it does not list", () => {
    const values = controlValuesFor(parsePackage(withFonts("serif", "serif", "sans")));
    expect(values.safeParse({ font: "sans", dateFormat: "yyyy" }).success).toBe(true);
    expect(values.safeParse({ margins: 0.5 }).error?.issues).toMatchObject([
      { path: ["margins"], message: "the template has no margins control" },
    ]);
    expect(values.safeParse({ font: "mono" }).error?.issues).toMatchObject([
      { path: ["font"], message: "mono is not one of the template's fonts" },
    ]);
  });
});

describe("slot vocabularies", () => {
  it("name the model's fields, so they cannot drift from it", () => {
    const fields = (schema: { shape: object }, ...without: string[]) =>
      Object.keys(schema.shape)
        .filter((key) => !without.includes(key))
        .sort();
    const slots = (vocabulary: object) => Object.keys(vocabulary).sort();
    expect(slots(ENTRY_SLOTS)).toEqual(fields(Entry, "id", "extras"));
    expect(slots(BULLET_SLOTS)).toEqual(fields(Bullet, "id"));
    expect(slots(ITEM_SLOTS)).toEqual(fields(Item, "id"));
    expect(slots(LABELLED_ITEM_SLOTS)).toEqual(fields(LabelledItem, "id"));
    expect(slots(LINK_SLOTS)).toEqual(fields(Link, "id", "kind"));
    expect(slots(HEADER_SLOTS)).toEqual(
      [...fields(Header, "name", "extras"), "first", "last", "contacts"].sort(),
    );
    const kinds = Section.options.map((option) => option.shape.kind.value);
    expect([...kinds].sort()).toEqual([...SECTION_KINDS].sort());
    for (const option of Section.options)
      expect(slots(SECTION_SLOTS[option.shape.kind.value])).toEqual(
        fields(option, "id", "kind", "role", "extras"),
      );
  });
});

describe("names the engine accepts", () => {
  it("needs an id the session takes as a format name", () => {
    const withId = (id: string) =>
      plainWith((pkg) => {
        pkg.id = id;
      });
    expect(issues(withId("plain"))).toEqual([]);
    for (const id of ["stock", "_plain", "-plain", "Plain"])
      expect(issues(withId(id)).map((issue) => issue.path)).toEqual(["id"]);
  });

  it("needs plain file names", () => {
    const withFile = (name: string) =>
      plainWith((pkg) => {
        pkg.files = { [name]: "" };
      });
    expect(issues(withFile("plain.sty"))).toEqual([]);
    for (const name of ["fonts/x.sty", ".hidden", ""])
      expect(issues(withFile(name)).map((issue) => issue.path)).toEqual([`files.${name}`]);
  });
});

describe("a XeTeX package's fonts", () => {
  /** The plain package on XeTeX, with the fonts given. */
  const xetexWith = (fonts: unknown, engine: "xetex" | "pdftex" = "xetex") =>
    plainWith((pkg) => {
      pkg.engine = engine;
      (pkg as Record<string, unknown>).fonts = fonts;
    });
  const roboto = {
    family: "Roboto",
    shapes: { "m/n": "Roboto-Regular.otf", "bx/it": "Roboto-BoldItalic.otf" },
    features: "mapping=tex-text;+onum",
  };
  const paths = (value: unknown) => issues(value).map((issue) => issue.path);

  it("names each family's shapes by file, with the features they load with", () => {
    const pkg = parsePackage(
      xetexWith([roboto, { family: "Icons5", shapes: { "m/n": "Lato-Black.ttf" } }]),
    );
    expect(pkg.fonts).toEqual([roboto, { family: "Icons5", shapes: { "m/n": "Lato-Black.ttf" } }]);
    // A package without fonts has none, and a pdfTeX package may have none.
    expect(parsePackage(plain).fonts).toBeUndefined();
    expect(paths(xetexWith([roboto], "pdftex"))).toEqual(["fonts"]);
  });

  it("holds a family to letters and digits, declared once, with a shape at least", () => {
    for (const family of ["Roboto Mono", "2Roboto", "Rob}oto", ""])
      expect(paths(xetexWith([{ ...roboto, family }])), family).toEqual(["fonts.0.family"]);
    expect(paths(xetexWith([roboto, roboto]))).toEqual(["fonts.1.family"]);
    expect(paths(xetexWith([{ ...roboto, shapes: {} }]))).toEqual(["fonts.0.shapes"]);
  });

  it("takes a resume's NFSS series and shapes, and nothing else", () => {
    for (const key of ["l/n", "m/ui", "m", "sb/n", "b/n/x"]) {
      const found = paths(xetexWith([{ ...roboto, shapes: { [key]: "Roboto-Regular.otf" } }]));
      expect(found.length, key).toBeGreaterThan(0);
      for (const path of found) expect(path, key).toMatch(/^fonts\.0\.shapes/);
    }
  });

  it("takes a plain OpenType or TrueType file name, which cannot break the declaration", () => {
    for (const file of [
      "Roboto-Regular.pfb",
      "fonts/Roboto-Regular.otf",
      ".Roboto.otf",
      "Roboto]:x.otf",
      'Roboto".otf',
      "Roboto Regular.otf",
      "Roboto}{x.otf",
    ])
      expect(paths(xetexWith([{ ...roboto, shapes: { "m/n": file } }])), file).toEqual([
        "fonts.0.shapes.m/n",
      ]);
  });

  it("takes features of XeTeX's syntax that go inside the declaration's quotes", () => {
    for (const features of ["mapping=tex-text]", 'a"b', "script:latn", "x}{\\input{y}", "a b", ""])
      expect(paths(xetexWith([{ ...roboto, features }])), features).toEqual(["fonts.0.features"]);
  });

  it("lists each file once, with the features its first family loads it with", () => {
    const pkg = parsePackage(
      xetexWith([
        roboto,
        { family: "Headings", shapes: { "b/n": "Roboto-Regular.otf", "m/n": "Lato-Black.ttf" } },
      ]),
    );
    expect(fontFiles(pkg)).toEqual([
      "Roboto-Regular.otf",
      "Roboto-BoldItalic.otf",
      "Lato-Black.ttf",
    ]);
    expect(fontFeatures(pkg)).toEqual(
      new Map([
        ["Roboto-Regular.otf", "mapping=tex-text;+onum"],
        ["Roboto-BoldItalic.otf", "mapping=tex-text;+onum"],
        ["Lato-Black.ttf", ""],
      ]),
    );
    expect(fontFiles(parsePackage(plain))).toEqual([]);
  });
});

describe("pageSizeFor", () => {
  it("follows CLDR's paper sizes, with A4 for a locale it cannot read", () => {
    for (const locale of ["en-US", "es-MX", "tl-PH", "en"]) {
      expect(pageSizeFor(locale)).toBe("letter");
    }
    for (const locale of ["en-GB", "de-CH", "pt-BR", "x", ""]) {
      expect(pageSizeFor(locale)).toBe("a4");
    }
  });
});

describe("defaultControls with a locale", () => {
  it("takes the page size from the locale when the package offers the control", () => {
    const a4 = parsePackage(
      plainWith((pkg) => {
        pkg.controls = { pageSize: { default: "a4", apply: { letter: "", a4: "" } } };
      }),
    );
    expect(defaultControls(a4, "en-US").pageSize).toBe("letter");
    expect(defaultControls(a4, "en-GB").pageSize).toBe("a4");
    expect(defaultControls(a4).pageSize).toBe("a4");
    expect(defaultControls(parsePackage(plain), "en-US")).toEqual({ dateFormat: "MMM yyyy" });
  });
});
