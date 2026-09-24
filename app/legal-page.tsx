import type { ReactNode } from "react";
import Link from "next/link";

interface LegalPageProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly effectiveDate: string;
  readonly children: ReactNode;
}

export default function LegalPage({ eyebrow, title, effectiveDate, children }: LegalPageProps) {
  return (
    <main>
      <header className="masthead">
        <Link className="wordmark home-link" href="/">WG<span aria-hidden="true"> / </span>Whale Gossip</Link>
        <span className="edition">Synthetic offline edition · 002</span>
      </header>
      <article className="legal-page">
        <header className="legal-heading">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>Effective {effectiveDate}</p>
        </header>
        <div className="legal-copy">{children}</div>
      </article>
      <footer className="site-footer">
        <span>Whale Gossip · Synthetic offline demo</span>
        <nav aria-label="Legal pages"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></nav>
      </footer>
    </main>
  );
}
