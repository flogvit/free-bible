import { BOOK_IDS } from './types.js';
import { REF_MARKUP_REGEX, parseRefMarkup } from './ref-markup.js';
import type { RefMarkup } from './ref-markup.js';

// ============================================================
// Ref markup renderer — converts [ref:...|...] to various formats
// ============================================================

export interface RefRendererOptions {
  /** Base URL prefix for links, e.g. "" or "https://bibel.no" */
  baseUrl?: string;
  /**
   * URL pattern. Placeholders:
   * - {book} = lowercase book abbreviation (e.g. "joh", "1mos")
   * - {bookId} = numeric book ID
   * - {chapter} = chapter number
   * - {verse} = verse number or spec
   * Default: "/{book}/{chapter}#{verse}"
   */
  urlPattern?: string;
}

const DEFAULT_URL_PATTERN = '/{book}/{chapter}#{verse}';

/**
 * Build a URL slug from a book abbreviation.
 * "1 Mos" → "1mos", "Joh" → "joh"
 */
function bookSlug(book: string): string {
  return book.toLowerCase().replace(/\s+/g, '');
}

/**
 * Build a URL for a ref markup.
 */
function buildUrl(ref: RefMarkup, options: RefRendererOptions = {}): string {
  const base = options.baseUrl ?? '';
  const pattern = options.urlPattern ?? DEFAULT_URL_PATTERN;
  const bookId = BOOK_IDS[ref.book];

  const url = pattern
    .replace('{book}', bookSlug(ref.book))
    .replace('{bookId}', String(bookId ?? 0))
    .replace('{chapter}', String(ref.chapter))
    .replace('{verse}', ref.verseSpec || '');

  // Clean up trailing # if no verse
  const cleaned = url.replace(/#$/, '');
  return base + cleaned;
}

/**
 * Render a single ref markup as HTML anchor.
 */
function renderHtml(ref: RefMarkup, options: RefRendererOptions = {}): string {
  const url = buildUrl(ref, options);
  const escaped = ref.displayText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<a href="${url}" class="bible-ref">${escaped}</a>`;
}

/**
 * Render a single ref markup as Markdown link.
 */
function renderMarkdown(ref: RefMarkup, options: RefRendererOptions = {}): string {
  const url = buildUrl(ref, options);
  const escaped = ref.displayText.replace(/[[\]]/g, '\\$&');
  return `[${escaped}](${url})`;
}

/**
 * Render a single ref markup as plain text (just the display text).
 */
function renderPlain(ref: RefMarkup): string {
  return ref.displayText;
}

export type RenderFormat = 'html' | 'markdown' | 'plain' | 'url';

/**
 * Render a single [ref:...|...] markup string to the specified format.
 */
export function renderRefMarkup(
  markup: string,
  format: RenderFormat,
  options: RefRendererOptions = {},
): string {
  const ref = parseRefMarkup(markup);
  switch (format) {
    case 'html': return renderHtml(ref, options);
    case 'markdown': return renderMarkdown(ref, options);
    case 'plain': return renderPlain(ref);
    case 'url': return buildUrl(ref, options);
  }
}

/**
 * Replace all [ref:...|...] markups in a text with the rendered format.
 */
export function renderAllRefMarkups(
  text: string,
  format: RenderFormat,
  options: RefRendererOptions = {},
): string {
  return text.replace(
    new RegExp(REF_MARKUP_REGEX.source, 'g'),
    (fullMatch) => {
      try {
        return renderRefMarkup(fullMatch, format, options);
      } catch {
        return fullMatch; // Leave invalid markups unchanged
      }
    },
  );
}
