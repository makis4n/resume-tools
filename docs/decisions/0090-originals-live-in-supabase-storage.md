# 0090. Originals live in Supabase Storage, private to their owner

Date: 2026-10-21 · Status: accepted, approved with the plan by the owner on 21 October 2026; amends
the plan's sections 8.1, 8.2 and 8.3, which the owner revised on 21 October 2026

## Context

The plan says two things about an imported resume's original upload. Sections 5.6 and 6.3 put it in
the document store, "visible only to its owner" and "stored in its owner's account and nowhere
else". Sections 8.1 and 8.2 put "uploads" and "uploaded originals" on Cloudflare R2, and say that
Cloudflare and Supabase "never talk to each other", each reached from the browser. R2 has no
per-person access rule of its own: a private file on R2 needs a Worker that checks the person's
Supabase session, which is server code between the two and makes them talk. Local Supabase, which
milestone 4 runs on (decision 0089), has no R2 beside it.

## Decision

- **An original upload is kept in Supabase Storage**, in one private bucket, `originals`, under a
  folder named after its owner's user id: `<user id>/<document id>/original.zip`, and beside it the
  import's own files, `<user id>/<document id>/import.bin` (decision 0091).
- **The bucket is private and has no signed or public links.** The browser reads and writes a file
  only through Storage's API with the person's session, and the policies of decision 0093 decide.
  A signed link would let anyone holding it read the file, so none is made.
- **R2 keeps what is the same for everyone**: the engine, the fonts and the TeX Live files. It holds
  nothing of any one person.
- **At hosting nothing moves.** The hosted project gets the same bucket and the same policies from
  the same migrations. "The two never talk" stays true.
- **The plan's sections 8.1, 8.2 and 8.3 are the owner's to revise**: R2's row loses "uploads", 8.2
  moves "uploaded originals" to Supabase, and 8.3's Supabase line counts originals beside saved
  resumes. docs/milestone-4.md lists the edits; this record does not make them.

## Consequences

- Originals count against Supabase's storage, which the free tier keeps small (1 GB), and every
  opening of an import on a new device downloads its original and import files against Supabase's
  monthly downloads (5 GB free). The import's own caps bound one upload at 20 MB of zip or
  100 MB unpacked; most resumes are a few hundred kilobytes. Milestone 5 measures the real sizes
  and decides whether a cap per account is needed.
- R2's free downloads no longer help with originals. They never would have without a Worker.
- One access model covers both rows and files: Postgres row-level security on `auth.uid()`, which
  one set of tests proves.
