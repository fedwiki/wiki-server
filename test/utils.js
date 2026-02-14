import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { asSlug, lastEdit, extractPageLinks, synopsis } from '../lib/utils.js'
import { resolveLinks, escape } from '../lib/render.js'

describe('utils', () => {
  describe('asSlug', () => {
    it('should replace spaces with hyphens', () => {
      assert.equal(asSlug('Hello World'), 'hello-world')
    })
    it('should lowercase the result', () => {
      assert.equal(asSlug('FooBar'), 'foobar')
    })
    it('should strip non-alphanumeric non-hyphen characters', () => {
      assert.equal(asSlug('Hello, World!'), 'hello-world')
    })
    it('should handle multiple consecutive spaces', () => {
      assert.equal(asSlug('a  b   c'), 'a--b---c')
    })
    it('should return empty string for empty input', () => {
      assert.equal(asSlug(''), '')
    })
    it('should handle tabs and newlines as spaces', () => {
      assert.equal(asSlug('a\tb\nc'), 'a-b-c')
    })
    it('should preserve digits and hyphens', () => {
      assert.equal(asSlug('page-123'), 'page-123')
    })
    it('should strip unicode characters', () => {
      assert.equal(asSlug('café'), 'caf')
    })
  })

  describe('lastEdit', () => {
    it('should return undefined for undefined journal', () => {
      assert.equal(lastEdit(undefined), undefined)
    })
    it('should return undefined for empty journal', () => {
      assert.equal(lastEdit([]), undefined)
    })
    it('should return the date of the last non-fork entry', () => {
      const journal = [
        { type: 'create', date: 100 },
        { type: 'edit', date: 200 },
        { type: 'fork', date: 300 },
      ]
      assert.equal(lastEdit(journal), 200)
    })
    it('should return undefined if all entries are forks', () => {
      const journal = [
        { type: 'fork', date: 100 },
        { type: 'fork', date: 200 },
      ]
      assert.equal(lastEdit(journal), undefined)
    })
    it('should skip entries without a date', () => {
      const journal = [
        { type: 'edit', date: 100 },
        { type: 'edit' },
      ]
      assert.equal(lastEdit(journal), 100)
    })
  })

  describe('extractPageLinks', () => {
    it('should extract wiki-style links from text', () => {
      const item = { id: 'i1', type: 'paragraph', text: 'see [[Some Page]] for details' }
      const links = [item].reduce(extractPageLinks, new Map())
      assert.equal(links.size, 1)
      assert.equal(links.get('some-page'), 'i1')
    })
    it('should extract multiple links from one item', () => {
      const item = { id: 'i1', type: 'paragraph', text: '[[Alpha]] and [[Beta]]' }
      const links = [item].reduce(extractPageLinks, new Map())
      assert.equal(links.size, 2)
      assert.equal(links.get('alpha'), 'i1')
      assert.equal(links.get('beta'), 'i1')
    })
    it('should not overwrite an existing slug with a later item id', () => {
      const items = [
        { id: 'i1', type: 'paragraph', text: '[[Target]]' },
        { id: 'i2', type: 'paragraph', text: '[[Target]]' },
      ]
      const links = items.reduce(extractPageLinks, new Map())
      assert.equal(links.get('target'), 'i1')
    })
    it('should extract slug from reference items', () => {
      const item = { id: 'i1', type: 'reference', slug: 'ref-page', text: '', site: 'example.com' }
      const links = [item].reduce(extractPageLinks, new Map())
      assert.equal(links.get('ref-page'), 'i1')
    })
    it('should return empty map when no links present', () => {
      const item = { id: 'i1', type: 'paragraph', text: 'no links here' }
      const links = [item].reduce(extractPageLinks, new Map())
      assert.equal(links.size, 0)
    })
  })

  describe('synopsis', () => {
    it('should use explicit synopsis field if present', () => {
      const page = { synopsis: 'explicit', story: [{ type: 'paragraph', text: 'from story' }] }
      assert.equal(synopsis(page), 'explicit')
    })
    it('should use first paragraph text', () => {
      const page = { story: [{ type: 'paragraph', text: 'first para' }] }
      assert.equal(synopsis(page), 'first para')
    })
    it('should fall back to second paragraph if first is not a paragraph', () => {
      const page = { story: [{ type: 'image', text: 'img' }, { type: 'paragraph', text: 'second para' }] }
      assert.equal(synopsis(page), 'second para')
    })
    it('should use first item text of any type if no paragraphs', () => {
      const page = { story: [{ type: 'markdown', text: 'md text' }] }
      assert.equal(synopsis(page), 'md text')
    })
    it('should report item count when no text available', () => {
      const page = { story: [{ type: 'factory' }, { type: 'factory' }] }
      assert.equal(synopsis(page), 'A page with 2 items.')
    })
    it('should handle page with no story', () => {
      assert.equal(synopsis({}), 'A page with no story.')
    })
    it('should truncate at first line break', () => {
      const page = { story: [{ type: 'paragraph', text: 'line one\nline two' }] }
      assert.equal(synopsis(page), 'line one')
    })
    it('should cap output at 560 characters', () => {
      const long = 'x'.repeat(600)
      const page = { story: [{ type: 'paragraph', text: long }] }
      assert.equal(synopsis(page).length, 560)
    })
  })

  describe('escape', () => {
    it('should escape ampersands', () => {
      assert.equal(escape('a & b'), 'a &amp; b')
    })
    it('should escape angle brackets', () => {
      assert.equal(escape('<div>'), '&lt;div&gt;')
    })
    it('should handle empty string', () => {
      assert.equal(escape(''), '')
    })
    it('should handle undefined', () => {
      assert.equal(escape(undefined), '')
    })
  })

  describe('resolveLinks', () => {
    it('should convert internal wiki links to anchor tags', () => {
      const result = resolveLinks('see [[Hello World]] here')
      assert.match(result, /class="internal"/)
      assert.match(result, /href="\/hello-world\.html"/)
      assert.match(result, /data-page-name="hello-world"/)
    })
    it('should convert external links to anchor tags', () => {
      const result = resolveLinks('see [http://example.com Example] here')
      assert.match(result, /class="external"/)
      assert.match(result, /href="http:\/\/example\.com"/)
      assert.match(result, /Example/)
    })
    it('should escape plain text', () => {
      const result = resolveLinks('a < b & c > d')
      assert.match(result, /&lt;/)
      assert.match(result, /&amp;/)
      assert.match(result, /&gt;/)
    })
    it('should pass resolution context into link titles', () => {
      const result = resolveLinks('[[Test]]', undefined, ['page-a', 'page-b'])
      assert.match(result, /title="page-a => page-b"/)
    })
    it('should handle empty string', () => {
      assert.equal(resolveLinks(''), '')
    })
    it('should mark spaced internal links', () => {
      const result = resolveLinks('[[ Hello ]]')
      assert.match(result, /class="internal spaced"/)
    })
    it('should accept a custom sanitizer', () => {
      const upper = s => s.toUpperCase()
      const result = resolveLinks('plain text', upper)
      assert.equal(result, 'PLAIN TEXT')
    })
  })
})
