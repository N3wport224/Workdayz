import Anthropic from "@anthropic-ai/sdk";

// Maps Anthropic SDK errors to user-facing messages + HTTP statuses so the
// UI can say "wait and retry" instead of a bare 500. Server-only (imports
// the SDK), used by the API route handlers.

export function describeAnthropicError(
  err: unknown,
  fallback: string,
): { message: string; status: number } {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 429) {
      return {
        message: "Anthropic rate limit reached — wait a minute and try again.",
        status: 429,
      };
    }
    if (err.status === 529 || err.status === 503) {
      return {
        message: "The Anthropic API is overloaded right now — try again in a moment.",
        status: 503,
      };
    }
    if (err.status === 401 || err.status === 403) {
      return {
        message:
          "The Anthropic API rejected your key — check ANTHROPIC_API_KEY in web/.env.local.",
        status: 500,
      };
    }
    if (err.status === 400 && /credit balance/i.test(err.message)) {
      return {
        message:
          "Your Anthropic account is out of credits — top up at console.anthropic.com, then retry.",
        status: 402,
      };
    }
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return {
      message: "Couldn't reach the Anthropic API — check your internet connection and retry.",
      status: 503,
    };
  }
  return { message: err instanceof Error ? err.message : fallback, status: 500 };
}
