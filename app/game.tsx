"use client";

import { useEffect, useRef, useState } from "react";
import { displayAction, type GuessApiResponse, type PublicQuestion, type PublicReveal } from "../lib/game/public-types";
import type { Guess } from "../lib/rules";

const CHOICES: readonly Guess[] = ["buy", "sell", "no-trade"];

function guessLabel(guess: Guess): string {
  return guess === "no-trade" ? "No trade of $2.5k+ within 48h" : displayAction(guess);
}

interface GameProps {
  readonly questions: readonly PublicQuestion[];
}

export default function Game({ questions }: GameProps) {
  const [roundIndex, setRoundIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [reveal, setReveal] = useState<PublicReveal | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const question = questions[roundIndex];

  useEffect(() => {
    if (reveal) feedbackRef.current?.focus();
  }, [reveal]);

  async function submitGuess(guess: Guess) {
    if (pending || reveal || !question) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/guess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roundId: question.roundId, guess }),
      });
      const result = (await response.json()) as GuessApiResponse;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setReveal(result.reveal);
      setScore((current) => current + result.reveal.points);
    } catch {
      setError("The offline reveal could not be loaded. Try this choice again.");
    } finally {
      setPending(false);
    }
  }

  function advance() {
    if (!reveal) return;
    if (roundIndex === questions.length - 1) {
      setFinished(true);
      requestAnimationFrame(() => headingRef.current?.focus());
      return;
    }
    setRoundIndex((current) => current + 1);
    setReveal(null);
    setError(null);
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function replay() {
    setRoundIndex(0);
    setScore(0);
    setReveal(null);
    setError(null);
    setFinished(false);
    setCopyStatus(null);
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  async function copyResult() {
    const text = `I scored ${score}/${questions.length} in the Whale Gossip synthetic offline demo.`;
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Result copied.");
    } catch {
      setCopyStatus(`Copy unavailable. Result: ${score}/${questions.length}.`);
    }
  }

  if (finished) {
    return (
      <section className="results-card" aria-labelledby="results-title">
        <p className="eyebrow">Five rounds complete</p>
        <h2 id="results-title" ref={headingRef} tabIndex={-1}>You scored {score} / {questions.length}</h2>
        <p className="results-copy">Every round used a deterministic, explicitly synthetic record. No live wallet activity was queried.</p>
        <div className="result-actions">
          <button className="primary-button" type="button" onClick={replay}>Play again</button>
          <button className="secondary-button" type="button" onClick={copyResult}>Copy result</button>
        </div>
        <p className="copy-status" aria-live="polite">{copyStatus}</p>
      </section>
    );
  }

  if (!question) return <p role="alert">The synthetic offline game could not be prepared.</p>;

  return (
    <section className="game-card" aria-labelledby="round-title">
      <div className="round-meta">
        <p className="eyebrow">Round {question.roundNumber} of {questions.length}</p>
        <p className="score" aria-label={`Current score ${score}`}>Score {score}</p>
      </div>
      <div className="progress" aria-hidden="true">
        {questions.map((item, index) => <span className={index <= roundIndex ? "active" : ""} key={item.roundId} />)}
      </div>

      <div className="question-heading">
        <div>
          <p className="synthetic-label">Synthetic Ethereum round</p>
          <h2 id="round-title" ref={headingRef} tabIndex={-1}>{question.token.symbol}</h2>
          <p className="token-name">{question.token.name} · watched by <strong>{question.walletPseudonym}</strong></p>
        </div>
        <div className="source-stamp">Rules v{question.rulesVersion}<br />{question.source}</div>
      </div>

      <div className="tape-panel">
        <div className="tape-heading">
          <h2>Last five qualifying trades</h2>
          <span>Before the hidden cutoff</span>
        </div>
        <ol className="trade-tape">
          {question.visibleTape.map((trade) => (
            <li key={trade.position}>
              <span className="trade-position">{String(trade.position).padStart(2, "0")}</span>
              <span>{trade.relativeTime}</span>
              <strong className={`action action-${trade.action.toLowerCase()}`}>{trade.action}</strong>
              <span className="size-band">{trade.sizeBand}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="guess-panel">
        <h2>{question.prompt}</h2>
        <p>A material move is a trade of $2.5k or more in this token.</p>
        <div className="choices" role="group" aria-label="Choose the next material move">
          {CHOICES.map((choice) => (
            <button
              type="button"
              key={choice}
              onClick={() => submitGuess(choice)}
              disabled={pending || reveal !== null}
              aria-pressed={reveal?.guess === choice}
            >
              {guessLabel(choice)}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="error-message" role="alert">{error}</p> : null}
      <p className="submission-status" aria-live="polite">{pending ? "Checking the synthetic record…" : ""}</p>

      {reveal ? (
        <div className={`reveal ${reveal.correct ? "correct" : "incorrect"}`} ref={feedbackRef} tabIndex={-1} aria-live="polite">
          <p className="verdict">{reveal.correct ? "Correct · +1 point" : "Not this time · 0 points"}</p>
          <h2>The recorded action was {reveal.recordedAction}.</h2>
          <p>{reveal.relativeElapsedTime}{reveal.sizeBand ? ` · ${reveal.sizeBand}` : ""}</p>
          <p>{reveal.explanation}</p>
          <button className="primary-button" type="button" onClick={advance}>
            {roundIndex === questions.length - 1 ? "See final score" : "Next round"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
