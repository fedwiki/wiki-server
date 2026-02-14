/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

// **utils.js**
// Pure utility functions shared across server modules.

/**
 * Convert a page name to a URL-safe slug.
 *
 * Whitespace becomes hyphens, non-alphanumeric/non-hyphen characters
 * are stripped, and the result is lowercased.
 *
 * @param {string} name - The human-readable page name.
 * @returns {string} The slugified form suitable for use in URLs and filenames.
 *
 * @example
 * asSlug('Hello World')  // 'hello-world'
 * asSlug('Café!')        // 'caf'
 */
export const asSlug = name =>
  name
    .replace(/\s/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '')
    .toLowerCase()

/**
 * Find the date of the most recent meaningful journal entry.
 *
 * Scans the journal array in reverse for the last entry that carries a
 * date and is not a fork action. Fork entries are excluded because they
 * record when content was copied from another site, not when a local
 * edit occurred.
 *
 * @param {Array<{type: string, date?: number}>} [journal] - The page journal.
 * @returns {number|undefined} Epoch-ms timestamp of the last edit, or
 *   undefined if the journal is missing, empty, or contains only forks.
 *
 * @example
 * lastEdit([{ type: 'edit', date: 200 }, { type: 'fork', date: 300 }])  // 200
 * lastEdit([])  // undefined
 */
export const lastEdit = journal => {
  if (!journal) return undefined
  const last = journal.findLast(action => {
    return action.date && action.type != 'fork'
  })
  return last ? last.date : undefined
}

/**
 * Extract a short summary from a page's content.
 *
 * Checks, in order: an explicit `synopsis` field on the page, then the
 * text of the first paragraph item, then the second paragraph item, then
 * the text of the first item of any type, then the second. Falls back to
 * a count of story items or a "no story" message.
 *
 * The result is trimmed to the first line and capped at 560 characters.
 *
 * @param {{synopsis?: string, story?: Array<{type: string, text?: string}>}} page
 * @returns {string} A plain-text summary of the page.
 *
 * @example
 * synopsis({ story: [{ type: 'paragraph', text: 'Hello world' }] })
 * // 'Hello world'
 */
export const synopsis = page => {
  let result = page.synopsis
  if (page?.story) {
    const p1 = page.story[0]
    const p2 = page.story[1]
    if (p1 && p1.type === 'paragraph') {
      result ||= p1.text
    }
    if (p2 && p2.type === 'paragraph') {
      result ||= p2.text
    }
    if (p1 && p1.text) {
      result ||= p1.text
    }
    if (p2 && p2.text) {
      result ||= p2.text
    }
    result ||= page.story && `A page with ${page.story.length} items.`
  } else {
    result = 'A page with no story.'
  }
  result = result.trim().split(/\r|\n/, 1)[0]
  return result.substring(0, 560)
}

/**
 * Reducer that accumulates collaborative links found in a story item.
 *
 * Extracts two kinds of links:
 *  - Wiki-style links: `[[Page Name]]` found anywhere in the item's text.
 *  - Reference items: items with `type: 'reference'` contribute their `slug`.
 *
 * Each link is stored as a Map entry keyed by the slugified page name,
 * with the value being the id of the first item that contains that link.
 * Subsequent items linking to the same slug do not overwrite the original.
 *
 * Intended for use with `Array.prototype.reduce` over a page's story array:
 *
 * @param {Map<string, string>} collaborativeLinks - Accumulator map of
 *   slug → item-id pairs built up across story items.
 * @param {{id: string, type: string, text?: string, slug?: string}} currentItem -
 *   The current story item being processed.
 * @param {number} currentIndex - Index of the current item in the story array.
 * @param {Array} array - The full story array (used only in error reporting).
 * @returns {Map<string, string>} The updated accumulator.
 *
 * @example
 * const links = page.story.reduce(extractPageLinks, new Map())
 * // Map { 'some-page' => 'item-id-1', 'other-page' => 'item-id-3' }
 */
export const extractPageLinks = (collaborativeLinks, currentItem, currentIndex, array) => {
  try {
    const linkRe = /\[\[([^\]]+)\]\]/g
    let match = undefined
    while ((match = linkRe.exec(currentItem.text)) != null) {
      if (!collaborativeLinks.has(asSlug(match[1]))) {
        collaborativeLinks.set(asSlug(match[1]), currentItem.id)
      }
    }
    if ('reference' == currentItem.type) {
      if (!collaborativeLinks.has(currentItem.slug)) {
        collaborativeLinks.set(currentItem.slug, currentItem.id)
      }
    }
  } catch (err) {
    console.log(
      `METADATA *** Error extracting links from ${currentIndex} of ${JSON.stringify(array)}`,
      err.message,
    )
  }
  return collaborativeLinks
}
