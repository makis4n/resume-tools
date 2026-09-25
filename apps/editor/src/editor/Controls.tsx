/**
 * The style controls beside the page: the ones plan section 5.4 lists that the template's package
 * offers, and no others. Each shows the document's effective value, its own choice or else the
 * package's default (`defaultControls`), so the panel never shows a control as unset. A change
 * goes to `onChange` as the control's name and its new value, which the app makes a command, so
 * that the page recompiles and undo takes it back as it takes back an edit. Every value the panel
 * can give is one the package's schema accepts, and every label is plain English: a user never
 * sees LaTeX, and the snippets that apply a value never leave the package.
 */

import { type CSSProperties, useId } from "react";
import { formatDate } from "../templates/dates";
import {
  type ControlValues,
  DateFormat,
  defaultControls,
  type TemplatePackage,
} from "../templates/package";

/** A change to one control: its name, and the value it takes. */
export type ControlChange = {
  [K in keyof ControlValues]-?: { name: K; value: NonNullable<ControlValues[K]> };
}[keyof ControlValues];

type OnChange = (change: ControlChange) => void;

export interface ControlsProps {
  pkg: TemplatePackage;
  /** The document's own choices; a control it has none for shows the package's default. */
  values: ControlValues;
  onChange: OnChange;
}

const PAGE_SIZES = [
  { size: "letter", name: "US Letter" },
  { size: "a4", name: "A4" },
] as const;

/** The marks on the margins slider that plan section 5.4 names, in inches. */
const MARGIN_MARKS = [
  { inches: 0.4, name: "Tight" },
  { inches: 0.7, name: "Normal" },
  { inches: 1, name: "Roomy" },
] as const;

/**
 * The accent palette: black, which keeps a template's own look, and seven colours dark enough for
 * a heading on white, each at least 6:1 against it.
 */
export const SWATCHES = [
  { colour: "#000000", name: "Black" },
  { colour: "#1F4E79", name: "Dark blue" },
  { colour: "#0F6B6B", name: "Teal" },
  { colour: "#2F6B3A", name: "Green" },
  { colour: "#6B2F5E", name: "Plum" },
  { colour: "#A0441C", name: "Rust" },
  { colour: "#4A5A6A", name: "Slate" },
  { colour: "#4A4A4A", name: "Dark grey" },
] as const;

const DENSITIES = [
  { density: "compact", name: "Compact" },
  { density: "normal", name: "Normal" },
  { density: "relaxed", name: "Relaxed" },
] as const;

/** The date each date format is shown with, so the menu reads as the page will. */
const EXAMPLE_DATE = "2024-01";

/**
 * The panel for one document. The package's defaults fill in what the document leaves out, so
 * each `??` below is only for the types, which cannot say which controls a package offers.
 */
export function Controls({ pkg, values, onChange }: ControlsProps) {
  const id = useId();
  const shown = { ...defaultControls(pkg), ...values };
  const { pageSize, margins, accent, density, dateFormat } = pkg.controls;
  return (
    <aside aria-label="Style" style={PANEL}>
      {pageSize && (
        <PageSizeControl
          id={`${id}-page-size`}
          value={shown.pageSize ?? pageSize.default}
          onChange={onChange}
        />
      )}
      {margins && (
        <MarginsControl
          id={`${id}-margins`}
          value={shown.margins ?? margins.default}
          onChange={onChange}
        />
      )}
      {accent && <AccentControl value={shown.accent ?? accent.default} onChange={onChange} />}
      {density && <DensityControl value={shown.density ?? density.default} onChange={onChange} />}
      {dateFormat && <DateFormatControl value={shown.dateFormat} onChange={onChange} />}
    </aside>
  );
}

/** US Letter or A4, as two radio buttons; `id` names their group. */
export function PageSizeControl({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ControlValues["pageSize"];
  onChange: OnChange;
}) {
  return (
    <fieldset style={GROUP}>
      <legend style={LEGEND}>Page size</legend>
      {PAGE_SIZES.map(({ size, name }) => (
        <label key={size}>
          <input
            type="radio"
            name={id}
            value={size}
            checked={value === size}
            onChange={() => onChange({ name: "pageSize", value: size })}
          />{" "}
          {name}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * A slider over the margins' range in its steps, with Tight, Normal and Roomy marked on it and
 * the value in inches beside it; `id` names the slider and its marks. The slider's value is text,
 * which the change reads to the tenth, so that 0.7 is 0.7 and not 0.7000000000000001.
 */
export function MarginsControl({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: OnChange;
}) {
  const slider = `${id}-slider`;
  const shown = value.toFixed(1);
  return (
    <div style={GROUP}>
      <div style={SPREAD}>
        <label htmlFor={slider} style={LEGEND}>
          Margins
        </label>
        <output htmlFor={slider} style={QUIET}>
          {shown} in
        </output>
      </div>
      <input
        id={slider}
        type="range"
        min={0.4}
        max={1}
        step={0.1}
        list={`${id}-marks`}
        value={value}
        aria-valuetext={`${shown} inches`}
        onChange={(event) =>
          onChange({ name: "margins", value: Math.round(Number(event.target.value) * 10) / 10 })
        }
      />
      <datalist id={`${id}-marks`}>
        {MARGIN_MARKS.map(({ inches, name }) => (
          <option key={inches} value={inches} label={name} />
        ))}
      </datalist>
      {/* Browsers draw a datalist's marks on a slider but not their names, so these do. */}
      <div aria-hidden="true" style={{ ...SPREAD, ...QUIET, fontSize: "12px" }}>
        {MARGIN_MARKS.map(({ inches, name }) => (
          <span key={inches}>{name}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * The palette's swatches, the current one marked, and a picker for any other colour. A colour is
 * kept as `#RRGGBB` in capitals, while the picker reads and writes lower case.
 */
export function AccentControl({ value, onChange }: { value: string; onChange: OnChange }) {
  const current = value.toUpperCase();
  return (
    <fieldset style={GROUP}>
      <legend style={LEGEND}>Accent colour</legend>
      <div style={ROW}>
        {SWATCHES.map(({ colour, name }) => (
          <button
            key={colour}
            type="button"
            title={name}
            aria-label={name}
            aria-pressed={current === colour}
            onClick={() => onChange({ name: "accent", value: colour })}
            style={{ ...SWATCH, background: colour, ...(current === colour ? CHOSEN : {}) }}
          />
        ))}
      </div>
      <label>
        Other colour{" "}
        <input
          type="color"
          value={current.toLowerCase()}
          onChange={(event) =>
            onChange({ name: "accent", value: event.target.value.toUpperCase() })
          }
        />
      </label>
    </fieldset>
  );
}

/** Compact, Normal and Relaxed, as three buttons, the current one pressed. */
export function DensityControl({
  value,
  onChange,
}: {
  value: ControlValues["density"];
  onChange: OnChange;
}) {
  return (
    <fieldset style={GROUP}>
      <legend style={LEGEND}>Density</legend>
      <div style={ROW}>
        {DENSITIES.map(({ density, name }) => (
          <button
            key={density}
            type="button"
            aria-pressed={value === density}
            onClick={() => onChange({ name: "density", value: density })}
            style={value === density ? { ...SEGMENT, ...PRESSED } : SEGMENT}
          >
            {name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** The four date formats, each shown as a date in it, since a pattern is not plain English. */
export function DateFormatControl({ value, onChange }: { value: DateFormat; onChange: OnChange }) {
  return (
    <label style={GROUP}>
      <span style={LEGEND}>Date format</span>
      <select
        value={value}
        onChange={(event) =>
          onChange({ name: "dateFormat", value: DateFormat.parse(event.target.value) })
        }
      >
        {DateFormat.options.map((format) => (
          <option key={format} value={format}>
            {formatDate(EXAMPLE_DATE, format)}
          </option>
        ))}
      </select>
    </label>
  );
}

const PANEL: CSSProperties = {
  flex: "none",
  width: "15rem",
  display: "flex",
  flexDirection: "column",
  gap: "1.25rem",
  font: "14px system-ui, sans-serif",
};
const GROUP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
  margin: 0,
  padding: 0,
  border: "none",
};
const LEGEND: CSSProperties = { padding: 0, fontWeight: 600 };
const QUIET: CSSProperties = { color: "#555" };
const ROW: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "0.4rem" };
const SPREAD: CSSProperties = { display: "flex", justifyContent: "space-between" };
const SWATCH: CSSProperties = {
  width: "1.5rem",
  height: "1.5rem",
  padding: 0,
  border: "2px solid white",
  borderRadius: "50%",
  boxShadow: "0 0 0 1px #999",
  cursor: "pointer",
};
const CHOSEN: CSSProperties = { boxShadow: "0 0 0 2px #1a73e8" };
const SEGMENT: CSSProperties = {
  flex: 1,
  padding: "0.3rem 0",
  border: "1px solid #999",
  borderRadius: "4px",
  background: "white",
  cursor: "pointer",
};
const PRESSED: CSSProperties = { background: "#e6e6e6", fontWeight: 600 };
