/**
 * Setting a new password (milestone 4 item 5, decision 0094), in two places: the recovery state,
 * which a reset link opens signed in, where the person sets a new password or leaves it for now;
 * and changing the password while signed in, which asks for the current one first. Both state the
 * rule before the person submits, and refuse a password that breaks it before any request.
 */
import { type FormEvent, useState } from "react";
import { PASSWORD_RULE } from "./messages";
import { keepsRule } from "./password";
import { PasswordField, TYPE_PASSWORD } from "./SignInPanel";

/** What the person reads once a new password is set. */
export const PASSWORD_SET = "Your new password is set.";

/** Where a new-password form is: being typed and maybe sent, with what went wrong. */
type Step = { sending: boolean; message?: string };

/** The recovery state: a reset link signed the person in, to set a new password. */
export function RecoveryPanel({
  email,
  onSet,
  onLater,
}: {
  email: string;
  /** Set the new password; resolves to what went wrong, or none. */
  onSet(password: string): Promise<string | undefined>;
  /** Leave without a new password, signed in. */
  onLater(): void;
}) {
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<Step>({ sending: false });

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (step.sending) return;
    if (password === "") return setStep({ sending: false, message: TYPE_PASSWORD });
    if (!keepsRule(password)) return setStep({ sending: false, message: PASSWORD_RULE });
    setStep({ sending: true });
    const problem = await onSet(password);
    if (problem !== undefined) setStep({ sending: false, message: problem });
  };

  return (
    <section aria-labelledby="recovery-title" style={{ maxWidth: "28rem" }}>
      <h2 id="recovery-title">Set a new password</h2>
      <p>
        The link signed you in as <strong>{email}</strong>. Choose a new password for this account.
      </p>
      <form noValidate onSubmit={(event) => void send(event)}>
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          disabled={step.sending}
          fresh
        />
        <button type="submit" disabled={step.sending}>
          {step.sending ? "Saving…" : "Save password"}
        </button>{" "}
        <button type="button" onClick={onLater} disabled={step.sending}>
          Not now
        </button>
        {step.message && <p role="alert">{step.message}</p>}
      </form>
    </section>
  );
}

/** Changing the password while signed in: the current one, then the new one. */
export function ChangePasswordPanel({
  email,
  onChange,
  onSendReset,
  onClose,
}: {
  email: string;
  /** Change the password; resolves to what went wrong, or none. */
  onChange(current: string, next: string): Promise<string | undefined>;
  /** Email a link to set a new password, for someone without one or who forgot it. */
  onSendReset(email: string): Promise<string | undefined>;
  onClose(): void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [step, setStep] = useState<Step & { done?: string }>({ sending: false });

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (step.sending) return;
    const say = (message: string) => setStep({ sending: false, message });
    if (current === "" || next === "") return say(TYPE_PASSWORD);
    if (!keepsRule(next)) return say(PASSWORD_RULE);
    setStep({ sending: true });
    const problem = await onChange(current, next);
    if (problem !== undefined) return say(problem);
    setCurrent("");
    setNext("");
    setStep({ sending: false, done: PASSWORD_SET });
  };

  const reset = async () => {
    setStep({ sending: true });
    const problem = await onSendReset(email);
    setStep(
      problem === undefined
        ? {
            sending: false,
            done: `We sent a link to set a new password to ${email}. Open it in this browser.`,
          }
        : { sending: false, message: problem },
    );
  };

  return (
    <section aria-labelledby="change-title" style={{ maxWidth: "28rem" }}>
      <h2 id="change-title">Change your password</h2>
      {step.done !== undefined ? (
        <p role="status">{step.done}</p>
      ) : (
        <form noValidate onSubmit={(event) => void send(event)}>
          <PasswordField
            label="Current password"
            value={current}
            onChange={setCurrent}
            disabled={step.sending}
            fresh={false}
          />
          <PasswordField
            label="New password"
            value={next}
            onChange={setNext}
            disabled={step.sending}
            fresh
          />
          <button type="submit" disabled={step.sending}>
            {step.sending ? "Saving…" : "Change password"}
          </button>
          {step.message && <p role="alert">{step.message}</p>}
          <p>
            No password yet, or forgotten it?{" "}
            <button type="button" onClick={() => void reset()} disabled={step.sending}>
              Email me a link to set one
            </button>
          </p>
        </form>
      )}
      <p>
        <button type="button" onClick={onClose} disabled={step.sending}>
          Close
        </button>
      </p>
    </section>
  );
}
