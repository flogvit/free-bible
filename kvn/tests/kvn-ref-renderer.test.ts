import { describe, it, expect } from 'bun:test';
import { renderRefMarkup, renderAllRefMarkups } from '../src/ref-renderer.js';

describe('renderRefMarkup', () => {
  describe('html', () => {
    it('renders a simple ref as HTML anchor', () => {
      const result = renderRefMarkup('[ref:Joh 3:16|Johannes 3:16]', 'html');
      expect(result).toBe('<a href="/joh/3#16" class="bible-ref">Johannes 3:16</a>');
    });

    it('renders a numbered book', () => {
      const result = renderRefMarkup('[ref:1 Mos 1:1|1. Mosebok 1:1]', 'html');
      expect(result).toBe('<a href="/1mos/1#1" class="bible-ref">1. Mosebok 1:1</a>');
    });

    it('renders a whole chapter', () => {
      const result = renderRefMarkup('[ref:Sal 23|Salme 23]', 'html');
      expect(result).toBe('<a href="/sal/23" class="bible-ref">Salme 23</a>');
    });

    it('escapes HTML in display text', () => {
      const result = renderRefMarkup('[ref:Joh 3:16|<script>alert("xss")</script>]', 'html');
      expect(result).toContain('&lt;script&gt;');
      expect(result).not.toContain('<script>');
    });

    it('uses custom baseUrl', () => {
      const result = renderRefMarkup('[ref:Joh 3:16|Johannes 3:16]', 'html', {
        baseUrl: 'https://bibel.no',
      });
      expect(result).toBe('<a href="https://bibel.no/joh/3#16" class="bible-ref">Johannes 3:16</a>');
    });

    it('uses custom urlPattern', () => {
      const result = renderRefMarkup('[ref:Joh 3:16|Johannes 3:16]', 'html', {
        urlPattern: '/bible/{bookId}/{chapter}/{verse}',
      });
      expect(result).toBe('<a href="/bible/43/3/16" class="bible-ref">Johannes 3:16</a>');
    });
  });

  describe('markdown', () => {
    it('renders a simple ref as Markdown link', () => {
      const result = renderRefMarkup('[ref:Joh 3:16|Johannes 3:16]', 'markdown');
      expect(result).toBe('[Johannes 3:16](/joh/3#16)');
    });

    it('renders a whole chapter', () => {
      const result = renderRefMarkup('[ref:Sal 23|Salme 23]', 'markdown');
      expect(result).toBe('[Salme 23](/sal/23)');
    });
  });

  describe('plain', () => {
    it('renders as plain text (just display text)', () => {
      const result = renderRefMarkup('[ref:Joh 3:16|Johannes 3:16]', 'plain');
      expect(result).toBe('Johannes 3:16');
    });
  });

  describe('url', () => {
    it('returns just the URL', () => {
      const result = renderRefMarkup('[ref:Joh 3:16|Johannes 3:16]', 'url');
      expect(result).toBe('/joh/3#16');
    });

    it('returns URL with base', () => {
      const result = renderRefMarkup('[ref:Joh 3:16|Johannes 3:16]', 'url', {
        baseUrl: 'https://bibel.no',
      });
      expect(result).toBe('https://bibel.no/joh/3#16');
    });
  });
});

describe('renderAllRefMarkups', () => {
  it('replaces all refs in text as HTML', () => {
    const text = 'Se [ref:Joh 3:16|Johannes 3:16] og [ref:1 Mos 1:1|1. Mosebok 1:1] her.';
    const result = renderAllRefMarkups(text, 'html');
    expect(result).toBe(
      'Se <a href="/joh/3#16" class="bible-ref">Johannes 3:16</a> og <a href="/1mos/1#1" class="bible-ref">1. Mosebok 1:1</a> her.',
    );
  });

  it('replaces all refs in text as plain', () => {
    const text = 'Se [ref:Joh 3:16|Johannes 3:16] og [ref:1 Mos 1:1|1. Mosebok 1:1] her.';
    const result = renderAllRefMarkups(text, 'plain');
    expect(result).toBe('Se Johannes 3:16 og 1. Mosebok 1:1 her.');
  });

  it('replaces all refs in text as Markdown', () => {
    const text = 'Se [ref:Joh 3:16|Johannes 3:16] her.';
    const result = renderAllRefMarkups(text, 'markdown');
    expect(result).toBe('Se [Johannes 3:16](/joh/3#16) her.');
  });

  it('leaves text without refs unchanged', () => {
    const text = 'Ingen referanser her.';
    expect(renderAllRefMarkups(text, 'html')).toBe(text);
  });

  it('leaves invalid refs unchanged', () => {
    const text = 'Se [ref:|bad] her.';
    expect(renderAllRefMarkups(text, 'html')).toBe(text);
  });
});
