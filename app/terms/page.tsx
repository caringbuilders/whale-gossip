import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = {
  title: "Terms of Use · Whale Gossip",
  description: "Terms of Use for the Whale Gossip synthetic offline demo.",
};

export default function TermsPage() {
  return (
    <LegalPage eyebrow="Public policy" title="Terms of Use" effectiveDate="September 24, 2026">
      <section>
        <h2>Purpose and eligibility</h2>
        <p>Whale Gossip is provided for educational and entertainment purposes. You must be at least 18 years old to use it. Use the service only lawfully, and do not disrupt, overload, probe, reverse engineer where prohibited, or otherwise interfere with the service or other users.</p>
      </section>
      <section>
        <h2>No advice or professional relationship</h2>
        <p>Nothing in Whale Gossip is investment, financial, legal, or tax advice, or a recommendation to buy, sell, or hold any asset. Your use does not create an adviser, broker, fiduciary, client, or other professional relationship. Make financial decisions using your own judgment and qualified advisers.</p>
      </section>
      <section>
        <h2>Information and risk</h2>
        <p>The current offline game uses synthetic records. Future releases may also present reviewed historical information. Synthetic examples may omit real-world complexity, historical information may be incomplete or delayed, and historical behavior does not predict future results. Crypto assets are volatile and risky, and you may lose some or all money committed to them.</p>
      </section>
      <section>
        <h2>Availability and warranties</h2>
        <p>The service is provided “as is” and “as available.” To the extent permitted by applicable law, no warranty is made about accuracy, completeness, availability, security, reliability, non-infringement, or fitness for a particular purpose. The project may correct, change, suspend, or end any part of the service at any time.</p>
      </section>
      <section>
        <h2>Responsibility and liability</h2>
        <p>You are responsible for how you use the service and any decisions you make. To the extent permitted by applicable law, the project maintainers will not be liable for indirect, incidental, special, consequential, or similar losses arising from use of or inability to use the service. Nothing here excludes liability or legal obligations that cannot lawfully be excluded or limited.</p>
      </section>
      <section>
        <h2>Project and third-party materials</h2>
        <p>The Whale Gossip name, interface, text, and original project materials are protected by applicable intellectual-property laws. Third-party names, services, links, and materials remain subject to their owners’ rights and terms. Nansen attribution identifies a planned API relationship; this offline deck uses synthetic data, not Nansen data, and attribution does not imply endorsement.</p>
      </section>
      <section>
        <h2>Third-party services</h2>
        <p>Links or integrations may lead to services controlled by others. Their own terms and policies apply, and Whale Gossip is not responsible for their content or operation.</p>
      </section>
      <section>
        <h2>Governing law and questions</h2>
        <p>Subject to mandatory rights and rules that apply where you live, these terms are governed by the laws of Ontario and the federal laws of Canada applicable there. This wording does not remove rights or obligations that cannot lawfully be changed by contract. Project questions may be raised through the public Whale Gossip GitHub repository if and when it is made available.</p>
      </section>
    </LegalPage>
  );
}
