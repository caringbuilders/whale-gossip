export default function Home() {
  return (
    <main>
      <header className="masthead">
        <span className="wordmark">WG<span aria-hidden="true"> / </span>Whale Gossip</span>
        <span className="edition">Development edition · 001</span>
      </header>

      <section className="intro" aria-labelledby="title">
        <p className="status"><span aria-hidden="true" />Offline development skeleton</p>
        <h1 id="title">Whale Gossip<span className="period">.</span></h1>
        <p className="tagline">Big trades. What happened next?</p>
        <p className="description">A planned game about observed Ethereum history. Read a wallet’s
          trading tape, make your guess, then discover its next material move.</p>
        <a className="text-link" href="#how-it-works">Explore the planned game <span aria-hidden="true">↗</span></a>
      </section>

      <section className="rules" id="how-it-works" aria-labelledby="rules-title">
        <div className="section-heading"><p className="eyebrow">The idea</p><h2 id="rules-title">Five rounds. One question.</h2></div>
        <ol className="steps">
          <li><span className="step-number" aria-hidden="true">01</span><h3>Read the tape</h3><p>Each round will feature one Ethereum token and a wallet’s last five qualifying trades before a historical cutoff.</p></li>
          <li><span className="step-number" aria-hidden="true">02</span><h3>Guess the next move</h3><p>Choose Buy, Sell, or No trade for the first material action in that token within the next 48 hours.</p></li>
          <li><span className="step-number" aria-hidden="true">03</span><h3>See what happened</h3><p>The planned reveal will show the recorded action and its evidence. One point per correct guess, across five rounds.</p></li>
        </ol>
        <p className="rule-note">“No trade” means no trade of $2.5k or more in the featured token within the full 48-hour window. It does not mean the wallet was inactive elsewhere.</p>
      </section>

      <aside className="build-note" aria-labelledby="build-title">
        <p className="eyebrow">Where we are</p>
        <h2 id="build-title">The foundation is here. The game is still to come.</h2>
        <p>This page is an offline development skeleton. No playable rounds, trade data, or results are available. Live data retrieval is disabled; Nansen integration is not implemented.</p>
      </aside>
      <footer><span>Whale Gossip</span><span>A game about history, not trading advice.</span></footer>
    </main>
  );
}
