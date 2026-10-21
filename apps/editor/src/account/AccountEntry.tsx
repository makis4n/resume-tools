/**
 * The account's entry in the editor's header (milestone 4 items 4 and 5): "Sign in", which opens
 * the sign-in panel, or, signed in, the account's email, "Change password" and "Sign out". A reset
 * link opens the recovery state, where the person sets a new password, and the link of "Make an
 * account" opens it to choose the first one (decision 0099). It shows only when the
 * editor has accounts (`accountsConfigured`); item 9 dresses the account's state further. With the
 * page's sync (item 7), "Sign out" sends what is pending first, and says which documents kept it
 * signed in when some could not be sent.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Account } from "./account";
import type { AccountSync } from "./account-sync";
import { ChangePasswordPanel, PASSWORD_SET, RecoveryPanel } from "./NewPassword";
import { SignInPanel } from "./SignInPanel";

const HEADER = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  alignItems: "baseline",
  gap: "0.5rem",
} as const;

export function AccountEntry({ account, sync }: { account: Account; sync?: AccountSync }) {
  const state = useSyncExternalStore(account.subscribe, account.state);
  const [opened, setOpened] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [changing, setChanging] = useState(false);
  const [said, setSaid] = useState<string>();

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

  const signOut = async () => {
    setChanging(false);
    setSaid(undefined);
    setSigningOut(true);
    setProblem(await (sync ?? account).signOut());
    setSigningOut(false);
    setOpened(false);
  };

  return (
    <header>
      <div style={HEADER}>
        {state.status === "checking" && <span role="status">Checking your account…</span>}
        {(state.status === "signed-in" || state.status === "recovering") && (
          <>
            <span>Signed in as {state.email}</span>
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
          </>
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
