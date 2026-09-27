/** What `scripts/fetch-engine.ts` writes to `.engine/manifest.json`, and the worker reads. */
export interface EngineManifest {
  /** The BusyTeX release the engine and the tree come from. */
  release: string;
  /** The version of what the script writes; a change rebuilds `.engine/`. */
  layout: number;
  /** The TeX Live bundles unpacked into the tree, in mounting order. */
  bundles: string[];
  /**
   * The packages added to the tree from TeX Live 2023's final archive, by name, with each one's
   * revision. Manifests written before layout 3 have none.
   */
  packages?: Record<string, number>;
  /** Every file TeX may read, by its path in the engine's file system, with its size in bytes. */
  files: Record<string, number>;
  /**
   * Every OpenType and TrueType file of the tree's `fonts/opentype` and `fonts/truetype` folders,
   * by its path, as its own tables describe it (`TreeFont`, decision 0023). Manifests written
   * before layout 7 have none.
   */
  fonts?: Record<string, TreeFont>;
}

/**
 * A font file of the tree as its tables name and describe it, which is what fontspec finds a font
 * by: XeTeX's font manager, which fontspec asks through fontconfig, matches a name to a file's
 * full name, its family and style, or its PostScript name, and a `/B` or `/I` to the face of the
 * family whose weight, width and slant come nearest (decision 0023). The names are the name
 * table's English ones, a Macintosh record's before a Windows one's, as XeTeX prefers them.
 */
export interface TreeFont {
  /**
   * The family and style XeTeX knows the font by: the typographic ones, name IDs 16 and 17, or 1
   * and 2 when the font has none.
   */
  family: string;
  style: string;
  /**
   * The family and subfamily, name IDs 1 and 2: the four-style family of Regular, Bold, Italic and
   * Bold Italic, which fontconfig knows the font by too.
   */
  fontFamily: string;
  fontSubfamily: string;
  /** The full name, name ID 4, and the PostScript name, name ID 6. */
  fullName: string;
  postScriptName: string;
  /**
   * The other names of each kind the name table gives on another platform, when it gives any, as
   * Latin Modern's Macintosh records name "Latin Modern Roman" where its Windows ones name "LM
   * Roman 12": XeTeX and fontconfig know the font by each.
   */
  more?: { family?: string[]; style?: string[]; fontFamily?: string[]; fullName?: string[] };
  /** The `OS/2` table's weight and width classes; 400 and 5 when it has none. */
  weight: number;
  width: number;
  /**
   * The `OS/2` table's italic, bold and regular flags, and the `head` table's italic and bold,
   * which XeTeX reads as its font manager does; written only when set.
   */
  italic?: true;
  bold?: true;
  regular?: true;
  /**
   * The `post` table's italic angle as XeTeX's font manager keeps it, a thousand times the tangent
   * of the angle leaning right; written only when not 0.
   */
  slant?: number;
  /** The scripts the `GSUB` and `GPOS` tables declare, by tag, each once, in order. */
  scripts: string[];
  /** The features the `GSUB` and `GPOS` tables declare, by tag, each once, in order. */
  features: string[];
}
