import type { Guess, TradeAction } from "../rules";

export const OFFLINE_GAME_LENGTH = 5;

export interface PublicTapeEntry {
  readonly position: number;
  readonly relativeTime: string;
  readonly action: "Buy" | "Sell";
  readonly sizeBand: string;
}

export interface PublicQuestion {
  readonly roundId: string;
  readonly roundNumber: number;
  readonly token: {
    readonly symbol: string;
    readonly name: string;
  };
  readonly walletPseudonym: string;
  readonly prompt: string;
  readonly visibleTape: readonly PublicTapeEntry[];
  readonly source: "Synthetic offline fixture";
  readonly rulesVersion: "4";
}

export interface PublicReveal {
  readonly roundId: string;
  readonly guess: Guess;
  readonly recordedAction: "Buy" | "Sell" | "No trade";
  readonly correct: boolean;
  readonly points: 0 | 1;
  readonly relativeElapsedTime: string;
  readonly sizeBand: string | null;
  readonly explanation: string;
  readonly source: "Synthetic offline fixture";
}

export type GuessApiResponse =
  | { readonly ok: true; readonly reveal: PublicReveal }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid-request" | "invalid-round-id" | "invalid-guess";
        readonly message: string;
      };
    };

export function isGuess(value: unknown): value is Guess {
  return value === "buy" || value === "sell" || value === "no-trade";
}

export function displayAction(action: TradeAction): "Buy" | "Sell";
export function displayAction(action: Guess): "Buy" | "Sell" | "No trade";
export function displayAction(action: Guess): "Buy" | "Sell" | "No trade" {
  if (action === "buy") return "Buy";
  if (action === "sell") return "Sell";
  return "No trade";
}
