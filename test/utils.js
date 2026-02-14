import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { asSlug, lastEdit, extractPageLinks } from '../lib/utils.js'

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
})
