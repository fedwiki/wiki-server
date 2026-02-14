/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

// **render.js**
// Server-side rendering of wiki pages to static HTML.
// Contains link resolution, HTML escaping, sanitization, and the
// top-level render function used to produce the story HTML served
// for `.html` page requests.

import f from 'flates'
import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'

import { asSlug } from './utils.js'

const window = new JSDOM('').window
const DOMPurify = createDOMPurify(window)

// ---- HTML escaping ----

/**
 * Escape HTML special characters in a string.
 *
 * @param {string} [string=''] - The raw text.
 * @returns {string} The text with &, <, > replaced by entities.
 */
export const escape = string => (string || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---- Link resolution ----

/**
 * Convert wiki-style link markup in a string to HTML anchor tags.
 *
 * Handles two kinds of links:
 *  - Internal wiki links: `[[Page Name]]` → `<a class="internal" ...>`
 *  - External links: `[http://example.com label text]` → `<a class="external" ...>`
 *
 * A stash/unstash mechanism protects generated HTML from being altered
 * by the sanitizer pass. The Unicode markers `〖n〗` are used as
 * placeholders; any pre-existing markers in the input are defused first.
 *
 * @param {string} [string=''] - The markup text to convert.
 * @param {function} [sanitize=escape] - A text sanitizer applied after
 *   link extraction but before unstashing. Plugins that do their own
 *   markup can substitute themselves here, but must escape HTML and
 *   pass through `〖n〗` markers.
 * @param {string[]} [resolutionContext=[]] - A stack of page names
 *   representing the navigation path, encoded into link title attributes.
 * @returns {string} HTML string with links converted to anchor tags.
 */
export const resolveLinks = (string, sanitize = escape, resolutionContext = []) => {
  const stashed = []

  const stash = text => {
    const here = stashed.length
    stashed.push(text)
    return `〖${here}〗`
  }

  const unstash = (match, digits) => stashed[+digits]

  const internal = (match, name) => {
    const slug = asSlug(name)
    const styling = name === name.trim() ? 'internal' : 'internal spaced'
    if (slug.length) {
      return stash(
        `<a class="${styling}" href="/${slug}.html" data-page-name="${slug}" title="${resolutionContext.join(' => ')}">${escape(name)}</a>`,
      )
    } else {
      return match
    }
  }

  const external = (match, href, rest) =>
    stash(
      `<a class="external" target="_blank" href="${href}" title="${href}" rel="noopener">${escape(rest)} <img src="/images/external-link-ltr-icon.png"></a>`,
    )

  string = (string || '')
    .replace(/〖(\d+)〗/g, '〖 $1 〗')
    .replace(/\[\[([^\]]+)\]\]/gi, internal)
    .replace(/\[((?:(?:https?|ftp):|\/).*?) (.*?)\]/gi, external)

  return sanitize(string).replace(/〖(\d+)〗/g, unstash)
}

// ---- Page rendering ----

/**
 * Render a wiki page's story to static HTML.
 *
 * Produces the twins, header, and story divs that form the page body
 * served for `.html` requests. Handles paragraph, image, html, and
 * generic story item types.
 *
 * @param {{title: string, story: Array<{type: string, text?: string, url?: string, caption?: string}>}} page
 *   The page object containing a title and story array.
 * @returns {string} An HTML string of the rendered page content.
 */
export const render = page => {
  return (
    f.div({ class: 'twins' }, f.p('')) +
    '\n' +
    f.div(
      { class: 'header' },
      f.h1(
        f.a({ href: '/', style: 'text-decoration: none' }, f.img({ height: '32px', src: '/favicon.png' })) +
          ' ' +
          page.title,
      ),
    ) +
    '\n' +
    f.div(
      { class: 'story' },
      page.story
        .map(story => {
          if (!story) return ''
          if (story.type === 'paragraph') {
            return f.div({ class: 'item paragraph' }, f.p(resolveLinks(story.text)))
          } else if (story.type === 'image') {
            return f.div(
              { class: 'item image' },
              f.img({ class: 'thumbnail', src: story.url }),
              f.p(resolveLinks(story.text || story.caption || 'uploaded image')),
            )
          } else if (story.type === 'html') {
            return f.div({ class: 'item html' }, f.p(resolveLinks(story.text || '', DOMPurify.sanitize)))
          } else {
            return f.div({ class: 'item' }, f.p(resolveLinks(story.text || '')))
          }
        })
        .join('\n'),
    )
  )
}
