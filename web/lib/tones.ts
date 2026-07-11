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

export const COVER_LETTER_LENGTHS = {
  short: "2 tight paragraphs, roughly 120 words total — for recruiters who skim.",
  standard: "3-4 short paragraphs, roughly 220 words total.",
  detailed: "4-5 paragraphs, roughly 340 words total — room for one fuller story.",
} as const;

export type CoverLetterLength = keyof typeof COVER_LETTER_LENGTHS;

export const LENGTH_LABELS: Record<CoverLetterLength, string> = {
  short: "Short (~120 words)",
  standard: "Standard (~220 words)",
  detailed: "Detailed (~340 words)",
};
