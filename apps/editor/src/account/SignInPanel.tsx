/**
 * Sign-in (milestone 4 item 4, decision 0094): a panel with the ways in, of which this item builds
 * the first, a link sent by email. The person types an email and asks for the link, and the panel
 * says to check that address. Item 5 adds the email and password beside it, as a way of its own in
 * the same panel. A sign-in link that came back and could not sign in says why above the ways in.
 */
import { type FormEvent, useState } from "react";
import { BAD_ADDRESS } from "./messages";

/** What the panel asks for before the address is sent. */
export const EMAIL_LINK_NOTE =
  "We email you a link that signs you in, and makes your account the first time. Open it in this browser.";

/** What the person reads when the address is left empty. */
export const TYPE_EMAIL = "Type your email address.";

/** An address worth sending: something, an @, and something with no spaces. */
const ADDRESS = /^[^\s@]+@[^\s@]+$/;

export interface SignInPanelProps {
  /** What a sign-in link that came back could not do, in the editor's words. */
  notice?: string;
  /** Email a sign-in link to the address; resolves to what went wrong, or none. */
  onSendLink(email: string): Promise<string | undefined>;
  /** Close the panel. */
  onClose(): void;
}

export function SignInPanel({ notice, onSendLink, onClose }: SignInPanelProps) {
  return (
    <section aria-labelledby="sign-in-title" style={{ maxWidth: "28rem" }}>
      <h2 id="sign-in-title">Sign in</h2>
      {notice && <p role="alert">{notice}</p>}
      <EmailLink onSend={onSendLink} />
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
    if (address === "") return setStep({ step: "form", sending: false, message: TYPE_EMAIL });
    if (!ADDRESS.test(address))
      return setStep({ step: "form", sending: false, message: BAD_ADDRESS });
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
