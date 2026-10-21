/**
 * Sign-in (milestone 4 items 4 and 5, decision 0094): a panel with the two ways in. The first is a
 * link sent by email: the person types an email and asks for the link, and the panel says to check
 * that address. The second is an email and a password, beside it: signing in; making an account,
 * which emails a link to confirm the address, after which the person chooses a password (decision
 * 0099); and "Forgot your password?", which emails a link to set a new one. A link that came back
 * and could not sign in says why above the ways in.
 */
import { type FormEvent, useId, useState } from "react";
import { BAD_ADDRESS, PASSWORD_HINT } from "./messages";

/** What the panel asks for before the address is sent. */
export const EMAIL_LINK_NOTE =
  "We email you a link that signs you in, and makes your account the first time. Open it in this browser.";

/** What the person reads when the address is left empty. */
export const TYPE_EMAIL = "Type your email address.";

/** What "Make an account" says before the address is sent: the password comes after the link. */
export const MAKE_ACCOUNT_NOTE =
  "We email you a link to confirm the address. Open it in this browser, and choose your password there.";

/** What the person reads when the password is left empty. */
export const TYPE_PASSWORD = "Type your password.";

/** An address worth sending: something, an @, and something with no spaces. */
const ADDRESS = /^[^\s@]+@[^\s@]+$/;

/** What is wrong with the address as typed, before anything is sent, or none. */
function addressProblem(address: string): string | undefined {
  if (address === "") return TYPE_EMAIL;
  if (!ADDRESS.test(address)) return BAD_ADDRESS;
  return undefined;
}

export interface SignInPanelProps {
  /** What a sign-in link that came back could not do, in the editor's words. */
  notice?: string;
  /** Email a sign-in link to the address; resolves to what went wrong, or none. */
  onSendLink(email: string): Promise<string | undefined>;
  /** Sign in with an email and a password; resolves to what went wrong, or none. */
  onSignIn(email: string, password: string): Promise<string | undefined>;
  /**
   * Make an account, which emails a link to confirm the address, and then asks for a password;
   * resolves to what went wrong, or none.
   */
  onSignUp(email: string): Promise<string | undefined>;
  /** Email a link to set a new password; resolves to what went wrong, or none. */
  onSendReset(email: string): Promise<string | undefined>;
  /** Close the panel. */
  onClose(): void;
}

export function SignInPanel({
  notice,
  onSendLink,
  onSignIn,
  onSignUp,
  onSendReset,
  onClose,
}: SignInPanelProps) {
  return (
    <section aria-labelledby="sign-in-title" style={{ maxWidth: "28rem" }}>
      <h2 id="sign-in-title">Sign in</h2>
      {notice && <p role="alert">{notice}</p>}
      <EmailLink onSend={onSendLink} />
      <WithPassword onSignIn={onSignIn} onSignUp={onSignUp} onSendReset={onSendReset} />
      <p>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </p>
    </section>
  );
}

/** Where the email link is: being typed and maybe sent, or sent to an address. */
type Step = { step: "form"; sending: boolean; message?: string } | { step: "sent"; email: string };

/** The first way in: an email, a link to it, and "Check your email" once it is sent. */
function EmailLink({ onSend }: { onSend(email: string): Promise<string | undefined> }) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<Step>({ step: "form", sending: false });

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (step.step !== "form" || step.sending) return;
    const address = email.trim();
    const wrong = addressProblem(address);
    if (wrong !== undefined) return setStep({ step: "form", sending: false, message: wrong });
    setStep({ step: "form", sending: true });
    const problem = await onSend(address);
    setStep(
      problem === undefined
        ? { step: "sent", email: address }
        : { step: "form", sending: false, message: problem },
    );
  };

  if (step.step === "sent")
    return (
      <div role="status">
        <h3>Check your email</h3>
        <p>
          We sent a sign-in link to <strong>{step.email}</strong>. Open it in this browser to sign
          in.
        </p>
        <button type="button" onClick={() => setStep({ step: "form", sending: false })}>
          Use another email
        </button>
      </div>
    );
  return (
    <form noValidate onSubmit={(event) => void send(event)}>
      <p>{EMAIL_LINK_NOTE}</p>
      <label>
        Email{" "}
        <input
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={step.sending}
        />
      </label>{" "}
      <button type="submit" disabled={step.sending}>
        {step.sending ? "Sending…" : "Email me a link"}
      </button>
      {step.message && <p role="alert">{step.message}</p>}
    </form>
  );
}

/** A password field, with the rule stated under it when a new password is being chosen. */
export function PasswordField({
  label,
  value,
  onChange,
  disabled,
  fresh,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  disabled: boolean;
  /** A new password, which the rule is stated for; otherwise one the person has already. */
  fresh: boolean;
}) {
  const hint = useId();
  return (
    <p>
      <label>
        {label}{" "}
        <input
          type="password"
          autoComplete={fresh ? "new-password" : "current-password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          {...(fresh ? { "aria-describedby": hint } : {})}
        />
      </label>
      {fresh && (
        <>
          <br />
          <small id={hint}>{PASSWORD_HINT}</small>
        </>
      )}
    </p>
  );
}

/** What the person is doing with a password: signing in, making an account, or resetting it. */
type Mode = "signIn" | "signUp" | "reset";

/** Where the password form is: being typed and maybe sent, or done, with what to say. */
type PasswordStep =
  | { step: "form"; sending: boolean; message?: string }
  | { step: "done"; mode: "signUp" | "reset"; email: string };

/** The second way in: an email and a password, to sign in, make an account, or reset it. */
function WithPassword({
  onSignIn,
  onSignUp,
  onSendReset,
}: Pick<SignInPanelProps, "onSignIn" | "onSignUp" | "onSendReset">) {
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<PasswordStep>({ step: "form", sending: false });
  const sending = step.step === "form" && step.sending;

  const switchTo = (next: Mode) => {
    setMode(next);
    setPassword("");
    setStep({ step: "form", sending: false });
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (step.step !== "form" || step.sending) return;
    const address = email.trim();
    const say = (message: string) => setStep({ step: "form", sending: false, message });
    const wrong = addressProblem(address);
    if (wrong !== undefined) return say(wrong);
    if (mode === "signIn" && password === "") return say(TYPE_PASSWORD);
    setStep({ step: "form", sending: true });
    const problem =
      mode === "signIn"
        ? await onSignIn(address, password)
        : mode === "signUp"
          ? await onSignUp(address)
          : await onSendReset(address);
    if (problem !== undefined) return say(problem);
    // Signed in, the panel closes; the others say what was sent.
    if (mode === "signIn") return setStep({ step: "form", sending: false });
    setPassword("");
    setStep({ step: "done", mode, email: address });
  };

  if (step.step === "done")
    return (
      <div role="status">
        {step.mode === "signUp" ? (
          <>
            <h3>Check your email to confirm</h3>
            <p>
              We sent a link to <strong>{step.email}</strong>. Open it in this browser to sign in
              and choose your password.
            </p>
          </>
        ) : (
          <>
            <h3>Check your email</h3>
            <p>
              If there is an account for <strong>{step.email}</strong>, we sent a link to set a new
              password. Open it in this browser. No email comes if there is no account.
            </p>
          </>
        )}
        <button type="button" onClick={() => switchTo("signIn")}>
          Back to sign in
        </button>
      </div>
    );

  const title =
    mode === "signIn"
      ? "Or sign in with a password"
      : mode === "signUp"
        ? "Make an account with a password"
        : "Forgot your password?";
  const submit =
    mode === "signIn" ? "Sign in" : mode === "signUp" ? "Make account" : "Email me a reset link";
  const pending =
    mode === "signIn" ? "Signing in…" : mode === "signUp" ? "Making account…" : "Sending…";
  return (
    <form noValidate onSubmit={(event) => void send(event)}>
      <h3>{title}</h3>
      {mode === "reset" && <p>We email you a link to set a new password.</p>}
      {mode === "signUp" && <p>{MAKE_ACCOUNT_NOTE}</p>}
      <p>
        <label>
          Email{" "}
          <input
            type="email"
            name="password-email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={sending}
          />
        </label>
      </p>
      {mode === "signIn" && (
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          disabled={sending}
          fresh={false}
        />
      )}
      <button type="submit" disabled={sending}>
        {sending ? pending : submit}
      </button>
      {step.step === "form" && step.message && <p role="alert">{step.message}</p>}
      <p>
        {mode !== "reset" && (
          <button type="button" onClick={() => switchTo("reset")} disabled={sending}>
            Forgot your password?
          </button>
        )}{" "}
        {mode === "signIn" ? (
          <button type="button" onClick={() => switchTo("signUp")} disabled={sending}>
            Make an account
          </button>
        ) : (
          <button type="button" onClick={() => switchTo("signIn")} disabled={sending}>
            I have an account
          </button>
        )}
      </p>
    </form>
  );
}
