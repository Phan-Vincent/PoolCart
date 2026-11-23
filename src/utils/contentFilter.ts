/**
 * Minimal objectionable-language filter for pool chat (App Store Review
 * Guideline 1.2 asks apps with user content to filter objectionable material).
 *
 * The server enforces the same list in public.contains_blocked_terms()
 * (supabase/schema.sql). Keep the two lists identical; a test checks this.
 *
 * Whole words only, with common endings, so "spicy", "Scunthorpe" or
 * "assorted" are never caught.
 */
export const BLOCKED_TERMS: readonly string[] = [
  'fuck',
  'motherfuck',
  'shit',
  'shitty',
  'bullshit',
  'bitch',
  'cunt',
  'asshole',
  'dickhead',
  'bastard',
  'whore',
  'slut',
  'fag',
  'faggot',
  'nigger',
  'nigga',
  'retard',
  'kike',
  'tranny',
];

/** Endings allowed after a term: fuck, fucks, bitchy, fucking, fucked, fucker, fuckers. */
export const BLOCKED_TERM_SUFFIXES = '(s|es|y|ing|ed|er|ers)?';

const BLOCKED_PATTERN = new RegExp(
  `\\b(${BLOCKED_TERMS.join('|')})${BLOCKED_TERM_SUFFIXES}\\b`,
  'i'
);

export const BLOCKED_TERMS_MESSAGE =
  "That message has language that isn't allowed in PoolCart. Please reword it.";

export function containsBlockedTerms(text: string): boolean {
  return BLOCKED_PATTERN.test(text || '');
}

export type ReportReason = 'spam' | 'harassment' | 'offensive' | 'other';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'offensive', label: 'Offensive' },
  { value: 'other', label: 'Something else' },
];
