import Game from "./game";
import { getPublicOfflineGame } from "../lib/server/synthetic-rounds";
import Link from "next/link";

export default function Home() {
  const questions = getPublicOfflineGame();

  return (
    <main>
      <header className="masthead">
        <span className="wordmark">WG<span aria-hidden="true"> / </span>Whale Gossip</span>
        <span className="edition">Synthetic offline edition · 002</span>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <div>
          <p className="status"><span aria-hidden="true" />Playable offline demo</p>
          <h1 id="page-title">Whale Gossip<span className="period">.</span></h1>
          <p className="tagline">Read the tape. Call the whale’s next move.</p>
        </div>
        <p className="hero-note"><strong>Explicitly synthetic data.</strong> Five deterministic Ethereum rounds. No live wallet data, network retrieval, or investment advice.</p>
      </section>

      <Game questions={questions} />

      <aside className="boundary-note" aria-labelledby="boundary-title">
        <p className="eyebrow">Demo boundary</p>
        <h2 id="boundary-title">History-shaped clues, fictional records.</h2>
        <p>The browser receives pseudonyms, relative times, and broad size bands. Exact synthetic wallet identities, transaction details, timestamps, values, and answers stay on the server side until a guess is submitted.</p>
      </aside>
      <footer className="site-footer">
        <div>
          <p>Built for the Nansen API · This offline demo uses synthetic data, not Nansen data.</p>
          <p>Synthetic offline demo · Not investment advice</p>
        </div>
        <nav aria-label="Legal pages"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></nav>
      </footer>
    </main>
  );
}
