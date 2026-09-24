import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy Notice · Whale Gossip",
  description: "Privacy Notice for the Whale Gossip synthetic offline demo.",
};

export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="Public policy" title="Privacy Notice" effectiveDate="September 24, 2026">
      <section>
        <h2>Current release</h2>
        <p>This offline release intentionally implements no accounts, email collection, wallet connection, advertising identifiers, or application analytics. It does not add optional cookies, so no consent banner is used for this release.</p>
      </section>
      <section>
        <h2>Gameplay data</h2>
        <p>Your guesses and score are processed to run the five-round game. The application does not intentionally persist them in this offline release. Copying a result uses your browser’s clipboard function at your request.</p>
      </section>
      <section>
        <h2>Technical information</h2>
        <p>Hosting and network infrastructure may automatically process IP addresses, device and browser details, request metadata, security events, and server logs to deliver, protect, and maintain the service. This means some personal information may be processed even though the application does not intentionally collect profile information.</p>
      </section>
      <section>
        <h2>Sharing, sale, and external services</h2>
        <p>Whale Gossip does not sell personal information. Infrastructure providers may process technical information on the project’s behalf under their own agreements. External links and services have their own privacy practices, which you should review before using them.</p>
      </section>
      <section>
        <h2>Retention and security</h2>
        <p>Technical records are retained only for operational, reliability, and security needs and according to relevant provider policies. Reasonable safeguards are used for the current release, but no system or transmission can be guaranteed absolutely secure.</p>
      </section>
      <section>
        <h2>Changes and questions</h2>
        <p>This notice must be reconsidered and updated before adding accounts, application analytics, Supabase persistence, production Nansen live mode, or other new collection or use of information. Project privacy questions may be raised through the public Whale Gossip GitHub repository if and when it is made available.</p>
      </section>
    </LegalPage>
  );
}
