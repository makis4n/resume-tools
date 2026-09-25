import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { curated } from "../templates/curated";
import { controlValuesFor, parsePackage } from "../templates/package";
import {
  AccentControl,
  type ControlChange,
  Controls,
  DateFormatControl,
  DensityControl,
  MarginsControl,
  PageSizeControl,
  SWATCHES,
} from "./Controls";

const { package: jake } = curated("jake");

/** The panel for Jake's Resume as HTML, with the document's own choices given. */
const panel = (values: Parameters<typeof Controls>[0]["values"]) =>
  renderToStaticMarkup(<Controls pkg={jake} values={values} onChange={() => {}} />);

/** The opening tag of the one `name` element in some HTML with `attribute`, as `value="a4"`. */
function tagWith(html: string, name: string, attribute: string): string {
  const tags = (html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? []).filter((tag) =>
    tag.includes(attribute),
  );
  if (tags.length !== 1) throw new Error(`${tags.length} ${name} tags have ${attribute}, not one`);
  return tags[0] as string;
}

/** Whether the button labelled `label`, by its text or its aria-label, is pressed. */
function pressed(html: string, label: string): boolean {
  const button = new RegExp(`<button\\b([^>]*)>${label}</button>`).exec(html)?.[1];
  const attributes = button ?? tagWith(html, "button", `aria-label="${label}"`);
  return attributes.includes('aria-pressed="true"');
}

type Props = Record<string, unknown>;

/**
 * Every element a tree holds, depth first, with each function component rendered in place, as a
 * shallow renderer would. The panel's controls use no hooks, so each can be called as a function,
 * and its handlers called as the browser would call them.
 */
function elementsOf(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement<Props>(node)) return [];
  if (typeof node.type === "function")
    return elementsOf((node.type as (props: Props) => ReactNode)(node.props));
  return [node, ...elementsOf(node.props.children as ReactNode)];
}

/** The props of the one element of a tree that `test` picks. */
function propsOf(tree: ReactNode, test: (element: ReactElement<Props>) => boolean): Props {
  const found = elementsOf(tree).filter(test);
  if (found.length !== 1) throw new Error(`${found.length} elements match, not one`);
  return (found[0] as ReactElement<Props>).props;
}

/** Call a handler as the browser would, with an event whose target holds `value`. */
const fire = (handler: unknown, value?: string) =>
  (handler as (event: { target: { value?: string } }) => void)({ target: { value } });

describe("Controls", () => {
  it("shows each control Jake's Resume offers at the package's default", () => {
    const html = panel({});
    expect(tagWith(html, "input", 'value="letter"')).toContain('checked=""');
    expect(tagWith(html, "input", 'value="a4"')).not.toContain("checked");
    expect(tagWith(html, "input", 'type="range"')).toContain('value="0.5"');
    expect(html).toContain(">0.5 in</output>");
    expect(pressed(html, "Black")).toBe(true);
    expect(tagWith(html, "input", 'type="color"')).toContain('value="#000000"');
    expect(pressed(html, "Normal")).toBe(true);
    expect(pressed(html, "Compact")).toBe(false);
    expect(tagWith(html, "option", 'value="MMM yyyy"')).toContain('selected=""');
  });

  it("shows the document's own choices over the defaults, a colour in either case", () => {
    const html = panel({
      pageSize: "a4",
      margins: 0.8,
      accent: "#1f4e79",
      density: "compact",
      dateFormat: "yyyy",
    });
    expect(tagWith(html, "input", 'value="a4"')).toContain('checked=""');
    expect(tagWith(html, "input", 'value="letter"')).not.toContain("checked");
    expect(tagWith(html, "input", 'type="range"')).toContain('value="0.8"');
    expect(html).toContain(">0.8 in</output>");
    expect(pressed(html, "Dark blue")).toBe(true);
    expect(pressed(html, "Black")).toBe(false);
    expect(tagWith(html, "input", 'type="color"')).toContain('value="#1f4e79"');
    expect(pressed(html, "Compact")).toBe(true);
    expect(pressed(html, "Normal")).toBe(false);
    expect(tagWith(html, "option", 'value="yyyy"')).toContain('selected=""');
    expect(tagWith(html, "option", 'value="MMM yyyy"')).not.toContain("selected");
  });

  it("names every choice in plain English, and shows no LaTeX", () => {
    const html = panel({});
    const words = [
      "Page size",
      "US Letter",
      "A4",
      "Margins",
      "Tight",
      "Roomy",
      "Accent colour",
      "Other colour",
      ...SWATCHES.map((swatch) => swatch.name),
      "Density",
      "Compact",
      "Relaxed",
      "Date format",
      "Jan 2024",
      "January 2024",
      "01/2024",
    ];
    for (const word of words) expect(html, word).toContain(word);
    expect(html).not.toContain("\\");
    expect(html).not.toMatch(/geometry|definecolor|titlespacing|setlist|rtaccent/);
  });

  it("shows only the controls a package offers", () => {
    const narrow = parsePackage({
      ...jake,
      id: "narrow",
      controls: { margins: { default: 0.7, apply: "\\geometry{margin={{value}}in}" } },
    });
    const html = renderToStaticMarkup(<Controls pkg={narrow} values={{}} onChange={() => {}} />);
    expect(html).toContain("Margins");
    expect(tagWith(html, "input", 'type="range"')).toContain('value="0.7"');
    for (const other of ["Page size", "Accent colour", "Density", "Date format"])
      expect(html).not.toContain(other);
  });

  it("offers a palette of distinct colours, black among them, each as #RRGGBB", () => {
    const colours = SWATCHES.map((swatch) => swatch.colour);
    expect(colours).toHaveLength(8);
    expect(new Set(colours).size).toBe(8);
    expect(colours).toContain(jake.controls.accent?.default);
    for (const colour of colours) expect(colour).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("gives each change as the control's name and a value the package accepts", () => {
    const changes: ControlChange[] = [];
    const onChange = (change: ControlChange) => changes.push(change);
    const is = (type: string, props: Props) => (element: ReactElement<Props>) =>
      element.type === type && Object.entries(props).every(([key, v]) => element.props[key] === v);

    const pageSize = <PageSizeControl id="size" value="letter" onChange={onChange} />;
    fire(propsOf(pageSize, is("input", { value: "a4" })).onChange);
    const margins = <MarginsControl id="margins" value={0.5} onChange={onChange} />;
    // The slider's value is text, read to the tenth.
    fire(propsOf(margins, is("input", { type: "range" })).onChange, "0.7000000000000001");
    const accent = <AccentControl value="#000000" onChange={onChange} />;
    fire(propsOf(accent, is("button", { "aria-label": "Teal" })).onClick);
    // The picker writes lower case, and the document keeps capitals.
    fire(propsOf(accent, is("input", { type: "color" })).onChange, "#aa0033");
    const density = <DensityControl value="normal" onChange={onChange} />;
    fire(propsOf(density, is("button", { children: "Relaxed" })).onClick);
    const dates = <DateFormatControl value="MMM yyyy" onChange={onChange} />;
    fire(propsOf(dates, is("select", {})).onChange, "MMMM yyyy");

    expect(changes).toEqual([
      { name: "pageSize", value: "a4" },
      { name: "margins", value: 0.7 },
      { name: "accent", value: "#0F6B6B" },
      { name: "accent", value: "#AA0033" },
      { name: "density", value: "relaxed" },
      { name: "dateFormat", value: "MMMM yyyy" },
    ]);
    const schema = controlValuesFor(jake);
    for (const { name, value } of changes)
      expect(schema.safeParse({ [name]: value }).success, name).toBe(true);
  });
});
