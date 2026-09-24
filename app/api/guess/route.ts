import { NextResponse } from "next/server";
import { isGuess, type GuessApiResponse } from "../../../lib/game/public-types";
import { getSyntheticReveal } from "../../../lib/server/synthetic-rounds";

function errorResponse(
  code: "invalid-request" | "invalid-round-id" | "invalid-guess",
  message: string,
): NextResponse<GuessApiResponse> {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<NextResponse<GuessApiResponse>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid-request", "The request must contain valid JSON.");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse("invalid-request", "The request must be an object.");
  }

  const entries = Object.entries(body);
  if (entries.length !== 2 || !("roundId" in body) || !("guess" in body)) {
    return errorResponse("invalid-request", "Only roundId and guess are accepted.");
  }

  const { roundId, guess } = body as Record<string, unknown>;
  if (typeof roundId !== "string" || roundId.length === 0) {
    return errorResponse("invalid-round-id", "Choose a valid offline round.");
  }
  if (!isGuess(guess)) {
    return errorResponse("invalid-guess", "Guess must be buy, sell, or no-trade.");
  }

  const reveal = getSyntheticReveal(roundId, guess);
  if (!reveal) return errorResponse("invalid-round-id", "Choose a valid offline round.");

  return NextResponse.json(
    { ok: true, reveal },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
