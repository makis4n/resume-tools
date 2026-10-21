/**
 * The account's entry in the editor's header (milestone 4 items 4, 5 and 9): "Sign in", which opens
 * the sign-in panel; "Checking your account…" while a stored session or a link is read; or, signed
 * in, the account's menu, under its email, with "Change password" and "Sign out" and what signing
 * out does to this browser, beside a quiet line of where the account's documents are (saving,
 * saved, offline). A reset link opens the recovery state, where the person sets a new password, and
 * the link of "Make an account" opens it to choose the first one (decision 0099). It shows only when
 * the editor has accounts (`accountsConfigured`).
 *
 * With the page's sync (items 7 and 9), the header asks what the account's sync waits on: the first
 * save's notice (decision 0091), read before anything is sent; the first sign-in's question
 * (decision 0092), whether to add the documents only in this browser, before any of them is sent;
 * and the sign-out warning, which names the documents not in the account and asks whether to sign
 * out all the same. Every word is the editor's own.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Account } from "./account";
import type { AccountSync, SyncState } from "./account-sync";
import {
  ADD_QUESTION,
  addDetail,
  SAVING_NOTICE,
  SAVING_TITLE,
  SIGN_OUT_ANYWAY,
  SIGN_OUT_NOTE,
  SYNC_NOT_ALL,
  SYNC_OFFLINE,
  SYNC_SAVED,
  SYNC_SAVING,
  unsentNotice,
} from "./messages";
import { ChangePasswordPanel, PASSWORD_SET, RecoveryPanel } from "./NewPassword";
import { SignInPanel } from "./SignInPanel";

const HEADER = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  alignItems: "baseline",
  gap: "0.5rem",
} as const;

/** The account's menu, under the email: its buttons in a column. */
const MENU = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: "0.25rem",
} as const;

/** The header's quiet line: smaller, and grey. */
const QUIET = { fontSize: "0.875rem", color: "#555" } as const;

/** A panel the header asks from. */
const PANEL = { maxWidth: "28rem" } as const;

/** The sync state of a page without sync: nothing asked, nothing syncing. */
const NO_SYNC: SyncState = { question: 0 };
const noSync = () => NO_SYNC;
const subscribeToNothing = () => () => {};

/** Whether the browser says it is online, and is told when that changes. */
function subscribeToConnection(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}
const isOnline = () => navigator.onLine !== false;

/**
 * The header's line of where the signed-in account's documents are: offline, saving while any waits
 * to be sent, a word for those the account could not keep, or saved. None while nothing syncs.
 */
export function syncLine(state: SyncState, online: boolean): string | undefined {
  if (state.syncing !== true) return undefined;
  if (!online) return SYNC_OFFLINE;
  const places = [...(state.places?.values() ?? [])];
  if (places.includes("waiting")) return SYNC_SAVING;
  if (places.includes("refused")) return SYNC_NOT_ALL;
  return SYNC_SAVED;
}

export function AccountEntry({ account, sync }: { account: Account; sync?: AccountSync }) {
  const state = useSyncExternalStore(account.subscribe, account.state);
  const synced = useSyncExternalStore(sync?.subscribe ?? subscribeToNothing, sync?.state ?? noSync);
  const online = useSyncExternalStore(subscribeToConnection, isOnline);
  const [opened, setOpened] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [changing, setChanging] = useState(false);
  const [said, setSaid] = useState<string>();
  const [answering, setAnswering] = useState(false);

  // The address and the storage are read once the page is up: a link's callback or a stored
  // session loads the client, and with neither nothing is loaded.
  useEffect(() => account.start(), [account]);

  // Sign-in is open when asked for, or when a link that came back says why it could not sign in.
  const panel = state.status === "signed-out" && (opened || state.notice !== undefined);
  // And it stays open once the person acts on that, as a new link sent clears the notice.
  const noticed = state.notice !== undefined;
  useEffect(() => {
    if (noticed) setOpened(true);
  }, [noticed]);
  // Opening sign-in loads the client, so sending the link waits less.
  useEffect(() => {
    if (panel) account.prepare();
  }, [account, panel]);

  /**
   * Sign out, through the sync when there is one. Documents not in the account are asked about in
   * the sign-out warning, which `discard` answers; anything else that went wrong is said.
   */
  const signOut = async (discard = false) => {
    setChanging(false);
    setSaid(undefined);
    setProblem(undefined);
    setSigningOut(true);
    const failed = sync === undefined ? await account.signOut() : await sync.signOut({ discard });
    setProblem(sync?.state().unsent === undefined ? failed : undefined);
    setSigningOut(false);
    setOpened(false);
  };

  /** Answer one of the sync's questions, once at a time. */
  const answer = async (act: () => Promise<void>) => {
    if (answering) return;
    setAnswering(true);
    try {
      await act();
    } finally {
      setAnswering(false);
    }
  };

  const signedIn = state.status === "signed-in" || state.status === "recovering";
  const line = signedIn ? syncLine(synced, online) : undefined;

  return (
    <header>
      <div style={HEADER}>
        {state.status === "checking" && <span role="status">Checking your account…</span>}
        {line !== undefined && (
          <span role="status" style={QUIET}>
            {line}
          </span>
        )}
        {signedIn && (
          <details>
            <summary>Signed in as {state.email}</summary>
            <div style={MENU}>
              {state.status === "signed-in" && !changing && (
                <button
                  type="button"
                  onClick={() => {
                    setSaid(undefined);
                    setChanging(true);
                  }}
                >
                  Change password
                </button>
              )}
              <button type="button" onClick={() => void signOut()} disabled={signingOut}>
                Sign out
              </button>
              <span style={QUIET}>{SIGN_OUT_NOTE}</span>
            </div>
          </details>
        )}
        {state.status === "signed-out" && !panel && (
          <button
            type="button"
            onClick={() => {
              setProblem(undefined);
              setOpened(true);
            }}
          >
            Sign in
          </button>
        )}
      </div>
      {problem && <p role="alert">{problem}</p>}
      {said && <p role="status">{said}</p>}
      {signedIn && synced.unsent !== undefined && (
        <section aria-labelledby="sign-out-title" style={PANEL}>
          <h2 id="sign-out-title">Sign out?</h2>
          <p role="alert">{unsentNotice(synced.unsent)}</p>
          <p>{SIGN_OUT_ANYWAY}</p>
          <p>
            <button type="button" onClick={() => void signOut(true)} disabled={signingOut}>
              Sign out anyway
            </button>{" "}
            <button type="button" onClick={() => sync?.stay()} disabled={signingOut}>
              Stay signed in
            </button>
          </p>
        </section>
      )}
      {signedIn && synced.telling === true && (
        <section aria-labelledby="saving-title" style={PANEL}>
          <h2 id="saving-title">{SAVING_TITLE}</h2>
          <p>{SAVING_NOTICE}</p>
          <p>
            <button
              type="button"
              disabled={answering}
              onClick={() => void answer(async () => sync?.tell())}
            >
              Save to my account
            </button>
          </p>
        </section>
      )}
      {signedIn && synced.telling !== true && synced.question > 0 && (
        <section aria-labelledby="add-title" style={PANEL}>
          <h2 id="add-title">{ADD_QUESTION}</h2>
          <p>{addDetail(synced.question)}</p>
          <p>
            <button
              type="button"
              disabled={answering}
              onClick={() => void answer(async () => sync?.answer("add"))}
            >
              Add them
            </button>{" "}
            <button
              type="button"
              disabled={answering}
              onClick={() => void answer(async () => sync?.answer("not-now"))}
            >
              Not now
            </button>
          </p>
        </section>
      )}
      {state.status === "recovering" && (
        <RecoveryPanel
          email={state.email ?? ""}
          first={state.first === true}
          onSet={async (password) => {
            const failed = await account.setPassword(password);
            if (failed === undefined) setSaid(PASSWORD_SET);
            return failed;
          }}
          onLater={() => account.endRecovery()}
        />
      )}
      {state.status === "signed-in" && changing && (
        <ChangePasswordPanel
          email={state.email ?? ""}
          onChange={(current, next) => account.changePassword(current, next)}
          onSendReset={(email) => account.sendReset(email)}
          onClose={() => setChanging(false)}
        />
      )}
      {panel && (
        <SignInPanel
          {...(state.notice === undefined ? {} : { notice: state.notice })}
          onSendLink={(email) => account.sendLink(email)}
          onSignIn={(email, password) => account.signIn(email, password)}
          onSignUp={(email) => account.signUp(email)}
          onSendReset={(email) => account.sendReset(email)}
          onClose={() => {
            setOpened(false);
            account.dismiss();
          }}
        />
      )}
    </header>
  );
}
