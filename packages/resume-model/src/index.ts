import { z } from "zod";

// The canonical resume model: the one structure every resume is stored in,
// whatever template it uses. See docs/plan.md, "The canonical model and
// template switching". This is a first draft and will change.

export const Run = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  href: z.string().url().optional(),
});
export type Run = z.infer<typeof Run>;

export const RichText = z.array(Run);
export type RichText = z.infer<typeof RichText>;

export const DateRange = z.object({
  start: z.string().regex(/^\d{4}(-\d{2})?$/, "YYYY or YYYY-MM"),
  end: z
    .string()
    .regex(/^\d{4}(-\d{2})?$/, "YYYY or YYYY-MM")
    .nullable(),
});
export type DateRange = z.infer<typeof DateRange>;

export const Entry = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  place: z.string().optional(),
  dates: DateRange.optional(),
  bullets: z.array(RichText),
});
export type Entry = z.infer<typeof Entry>;

export const Section = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("entries"),
    id: z.string(),
    title: z.string(),
    entries: z.array(Entry),
  }),
  z.object({
    kind: z.literal("list"),
    id: z.string(),
    title: z.string(),
    items: z.array(RichText),
  }),
]);
export type Section = z.infer<typeof Section>;

export const Link = z.object({ label: z.string(), href: z.string() });
export type Link = z.infer<typeof Link>;

export const Header = z.object({
  name: z.string(),
  headline: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  links: z.array(Link),
});
export type Header = z.infer<typeof Header>;

export const Resume = z.object({
  version: z.literal(1),
  header: Header,
  sections: z.array(Section),
  // Fields an imported template has and this model lacks. Kept so nothing is
  // lost on import; dropped, with a warning, when switching to a template
  // that cannot show them.
  extras: z.record(z.string(), z.unknown()).optional(),
});
export type Resume = z.infer<typeof Resume>;
