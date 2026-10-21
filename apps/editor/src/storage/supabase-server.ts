/**
 * The sync queue's account on Supabase (milestone 4 item 7, decisions 0092, 0093 and 0098): the
 * `SyncServer` over the `documents` table, through the editor's one client, which the account
 * passes in once someone is signed in. Only the client's type is imported here, so a page that
 * makes no server loads none of `@supabase/supabase-js`.
 *
 * The table's row-level security keeps each account to its own rows, so nothing here filters by
 * owner: a policy that let another account's rows through would show in the tests, not be hidden.
 * Every request is made as the queue's user, whatever another tab has signed in as since
 * (`authorization`), so the owner the table defaults to the caller is that user. The table's
 * trigger counts the revision and stamps the times, so a write sends none of them. Every row read is checked before the queue sees it, since
 * whatever wrote it may not be this editor.
 *
 * Errors: a request that never reached the account, a failure on its side, a session it no longer
 * takes, or too many requests is `ServerUnavailable`, which the queue waits on and tries again. A
 * refusal sending again cannot change (decision 0098) is `ServerRefused`. Anything else is an error
 * of its own, which the queue reports to the console and tries again after a wait. None of
 * Supabase's text goes further than the console.
 */
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  type ServerDocument,
  type ServerEntry,
  ServerRefused,
  ServerUnavailable,
  type SyncServer,
  type Upload,
  type WriteResult,
} from "./server";

/** The table the account's documents are kept in. */
const TABLE = "documents";

/** The columns of a whole row, as `get` reads it. */
const COLUMNS = "id, kind, template_id, title, document, revision, created_at, updated_at";

/** A time as Postgres writes it, read into milliseconds since the epoch. */
const Time = z.string().transform((text, context) => {
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) {
    context.addIssue({ code: "custom", message: "not a time" });
    return z.NEVER;
  }
  return ms;
});

const Revision = z.number().int().positive();

const EntryRow = z.object({ id: z.string(), revision: Revision, updated_at: Time });

const DocumentRow = z.object({
  id: z.string(),
  kind: z.enum(["template", "tex", "pdf"]),
  template_id: z.string(),
  title: z.string(),
  // Any JSON; the store checks it against the model when the document is opened.
  document: z.unknown().refine((value) => value !== undefined && value !== null),
  revision: Revision,
  created_at: Time,
  updated_at: Time,
});

const Written = z.object({ revision: Revision, updated_at: Time });

/**
 * The codes of a refusal sending again cannot change (decision 0098): a check (`23514`), a string
 * `jsonb` or `text` cannot hold (`22P05`, `22P02`), and a write the policies or the trigger refuse
 * the signed-in caller (`42501`, which PostgREST answers with 403; without a session it is 401).
 * PostgREST refuses a body it cannot read as JSON itself, before Postgres sees it (`PGRST102`), as
 * it does one holding a lone surrogate's escape: that is the same refusal as `22P02`.
 */
const REFUSALS = new Set(["23514", "22P05", "22P02", "42501", "PGRST102"]);

/** The answer a request came to: what PostgREST's builders resolve with. */
interface Answer {
  error: PostgrestError | null;
  status: number;
}

/**
 * What an error answer means to the queue. A request that never reached the account (status 0), a
 * failure on its side (5xx), a session it does not take (401, as one that ran out), a timeout (408)
 * and too many requests (429) pass: `ServerUnavailable`. A refusal of decision 0098 does not:
 * `ServerRefused`. Anything else is reported as an error, with the code only.
 */
function failureOf({ error, status }: Answer, what: string): Error {
  const code = error?.code ?? "";
  if (status === 0 || status >= 500 || status === 401 || status === 408 || status === 429)
    return new ServerUnavailable(`the account could not be reached (${status} ${code})`.trim(), {
      cause: error,
    });
  if (REFUSALS.has(code)) return new ServerRefused(code, { cause: error });
  return new Error(`the account did not ${what} (${status} ${code})`, { cause: error });
}

/** A row read, checked; one that is not as the table keeps them is not trusted. */
function parsed<T>(schema: z.ZodType<T>, row: unknown): T {
  const read = schema.safeParse(row);
  if (!read.success) throw new Error("the account answered with a row the editor cannot read");
  return read.data;
}

/**
 * How many entries `list` asks for at a time. PostgREST cuts any answer to its `max_rows` (1000 in
 * `supabase/config.toml`, as on hosted Supabase) without saying so, and a document the list left
 * out would be taken as deleted on another device; so the list goes page by page, by id, until a
 * page comes back empty, which holds whatever `max_rows` is.
 */
export const LIST_PAGE = 500;

export class SupabaseServer implements SyncServer {
  /**
   * `user` is the account the queue syncs: every request is made with that user's session, read
   * when the request is made and pinned onto it, and none is made while the client holds another
   * account's, as when another tab of this browser has signed in as someone else.
   */
  constructor(
    private readonly client: SupabaseClient,
    private readonly user: string,
  ) {}

  /**
   * The `Authorization` a request of `user`'s carries. The client reads its session from the
   * browser's storage, which every tab shares, at each request: another tab signing in as another
   * account changes it under this one, which hears of it only later. So the session is read here,
   * checked to be `user`'s, and its token set on the request itself, which the client then keeps.
   * Another account's session, or none, passes (`ServerUnavailable`): the queue waits, and is
   * stopped or moved to the new account as soon as this tab hears of it.
   */
  private async authorization(): Promise<string> {
    const { data, error } = await this.client.auth.getSession();
    const session = data.session;
    if (error !== null || session === null)
      throw new ServerUnavailable("the account's session could not be read", { cause: error });
    if (session.user.id !== this.user)
      throw new ServerUnavailable("this browser's session is now another account's");
    return `Bearer ${session.access_token}`;
  }

  async list(): Promise<ServerEntry[]> {
    const entries: ServerEntry[] = [];
    let after: string | undefined;
    for (;;) {
      const authorization = await this.authorization();
      const page = this.client.from(TABLE).select("id, revision, updated_at");
      const answer = await (after === undefined ? page : page.gt("id", after))
        .order("id")
        .limit(LIST_PAGE)
        .setHeader("Authorization", authorization);
      if (answer.error) throw failureOf(answer, "list the documents");
      const rows = parsed(z.array(EntryRow), answer.data);
      if (rows.length === 0) return entries;
      for (const { id, revision, updated_at } of rows)
        entries.push({ id, revision, updatedAt: updated_at });
      after = rows[rows.length - 1]?.id;
    }
  }

  async get(id: string): Promise<ServerDocument | null> {
    const authorization = await this.authorization();
    const answer = await this.client
      .from(TABLE)
      .select(COLUMNS)
      .eq("id", id)
      .setHeader("Authorization", authorization)
      .maybeSingle();
    if (answer.error) throw failureOf(answer, "give the document");
    if (answer.data === null) return null;
    const row = parsed(DocumentRow, answer.data);
    return {
      id: row.id,
      kind: row.kind,
      templateId: row.template_id,
      title: row.title,
      document: row.document,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async insert(doc: Upload): Promise<WriteResult> {
    const authorization = await this.authorization();
    // The owner, the revision and both times are the table's own: the owner is the caller, whom
    // `authorization` has made `user`.
    const answer = await this.client
      .from(TABLE)
      .insert({
        id: doc.id,
        kind: doc.kind,
        template_id: doc.templateId,
        title: doc.title,
        document: doc.document,
      })
      .select("revision, updated_at")
      .setHeader("Authorization", authorization)
      .single();
    // The id is taken, by this account or, out of sight, another's.
    if (answer.error?.code === "23505") return { ok: false, reason: "conflict" };
    if (answer.error) throw failureOf(answer, "keep the new document");
    return writtenOf(answer.data);
  }

  async update(doc: Upload, expectedRevision: number): Promise<WriteResult> {
    const authorization = await this.authorization();
    // The kind stays as the insert set it; the trigger counts the revision on.
    const answer = await this.client
      .from(TABLE)
      .update({ template_id: doc.templateId, title: doc.title, document: doc.document })
      .eq("id", doc.id)
      .eq("revision", expectedRevision)
      .select("revision, updated_at")
      .setHeader("Authorization", authorization);
    if (answer.error) throw failureOf(answer, "keep the document");
    const rows = parsed(z.array(z.unknown()), answer.data);
    if (rows.length > 0) return writtenOf(rows[0]);
    // No row at that revision: it moved on, or it is gone.
    const found = await this.client
      .from(TABLE)
      .select("id")
      .eq("id", doc.id)
      .setHeader("Authorization", authorization)
      .maybeSingle();
    if (found.error) throw failureOf(found, "say whether the document is there");
    return { ok: false, reason: found.data === null ? "missing" : "conflict" };
  }

  async remove(id: string): Promise<void> {
    const authorization = await this.authorization();
    const answer = await this.client
      .from(TABLE)
      .delete()
      .eq("id", id)
      .setHeader("Authorization", authorization);
    if (answer.error) throw failureOf(answer, "delete the document");
  }
}

/** What a write that went through says: the account's revision and time now. */
function writtenOf(row: unknown): WriteResult {
  const { revision, updated_at } = parsed(Written, row);
  return { ok: true, revision, updatedAt: updated_at };
}
