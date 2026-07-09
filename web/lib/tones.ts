// Shared between the server-side tailoring engine and the client UI.
// Kept free of server-only imports so client components can use it.

export const COVER_LETTER_TONES = {
  professional: "Polished and professional — measured confidence, no exclamation marks.",
  enthusiastic: "Energetic and genuinely excited about the role, while staying substantive.",
  confident: "Direct and assertive — lead with impact and let accomplishments carry the letter.",
  conversational: "Warm and personable, like a well-written email to a future colleague.",
} as const;

export type CoverLetterTone = keyof typeof COVER_LETTER_TONES;

export const TONE_LABELS: Record<CoverLetterTone, string> = {
  professional: "Professional",
  enthusiastic: "Enthusiastic",
  confident: "Confident",
  conversational: "Conversational",
};
