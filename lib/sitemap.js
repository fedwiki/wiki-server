/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

// **sitemap.js**
// Maintains the JSON and XML sitemaps.
//
// In-memory mutations (update/remove) are synchronous.
// Persistence is debounced — rapid successive edits coalesce
// into a single file write.

import fsp from 'node:fs/promises'
import path from 'node:path'
import events from 'node:events'
import writeFileAtomic from 'write-file-atomic'
import xml2js from 'xml2js'

import { asSlug, lastEdit, extractPageLinks, synopsis } from './utils.js'

const writeAtomic = (loc, data) =>
  new Promise((resolve, reject) => writeFileAtomic(loc, data, err => (err ? reject(err) : resolve())))

export default argv => {
  const wikiName = new URL(argv.url).hostname

  let sitemap = []
  let pagehandlerRef = null

  const sitemapLoc = path.join(argv.status, 'sitemap.json')
  const xmlSitemapLoc = path.join(argv.status, 'sitemap.xml')

  // ms before clearing sitemap from memory after last save
  const sitemapTimeoutMs = 120000
  let sitemapTimeoutHandler = null

  let working = false
  let dirty = false
  let saveTimer = null
  const SAVE_DELAY_MS = 100

  const itself = new events.EventEmitter()

  // ---- Internal helpers ----

  const extractLinks = page => {
    let map
    try {
      map = page.story.reduce(extractPageLinks, new Map())
    } catch (err) {
      console.log(`METADATA *** ${wikiName} reduce to extract links failed`, err.message)
      return undefined
    }
    return map.size > 0 ? Object.fromEntries(map) : undefined
  }

  const sitemapEntry = (file, page) => ({
    slug: file,
    title: page.title,
    date: lastEdit(page.journal),
    synopsis: synopsis(page),
    links: extractLinks(page),
  })

  const applyUpdate = (file, page) => {
    const idx = sitemap.findIndex(e => e.slug === file)
    const entry = sitemapEntry(file, page)
    if (idx !== -1) {
      sitemap[idx] = entry
    } else {
      sitemap.push(entry)
    }
  }

  const applyRemove = file => {
    const idx = sitemap.findIndex(e => e.slug === file)
    if (idx !== -1) sitemap.splice(idx, 1)
  }

  const buildXml = sitemap => {
    const urls = sitemap.map(page => {
      const entry = { loc: argv.url + '/' + page.slug + '.html' }
      if (page.date) {
        const d = new Date(page.date)
        if (!isNaN(d.valueOf())) {
          entry.lastmod = d.toISOString().substring(0, 10)
        }
      }
      return entry
    })
    const obj = {
      urlset: {
        $: { xmlns: 'http://www.sitemaps.org/schemas/sitemap/0.9' },
        url: urls,
      },
    }
    return new xml2js.Builder().buildObject(obj)
  }

  const save = async () => {
    try {
      await fsp.mkdir(argv.status, { recursive: true })
      await writeAtomic(sitemapLoc, JSON.stringify(sitemap))
      await writeAtomic(xmlSitemapLoc, buildXml(sitemap))
    } catch (e) {
      console.log(`Problems saving sitemap ${wikiName}:`, e)
    }
  }

  const scheduleSave = () => {
    dirty = true
    if (saveTimer) return
    saveTimer = setTimeout(async () => {
      saveTimer = null
      dirty = false
      await save()
      itself.stop()
      // If more mutations arrived during save, save again
      if (dirty) scheduleSave()
    }, SAVE_DELAY_MS)
  }

  const restore = async () => {
    try {
      await fsp.access(sitemapLoc)
      const data = await fsp.readFile(sitemapLoc, 'utf8')
      sitemap = JSON.parse(data)
    } catch {
      // File doesn't exist or is corrupt — will be rebuilt by createSitemap
      sitemap = []
    }
  }

  const ensureLoaded = async () => {
    if (sitemap.length === 0 && !working) {
      await restore()
      if (sitemap.length === 0 && pagehandlerRef) {
        await itself.createSitemap(pagehandlerRef)
      }
    }
  }

  const resetTimeout = () => {
    clearTimeout(sitemapTimeoutHandler)
    if (!argv.test) {
      sitemapTimeoutHandler = setTimeout(() => {
        console.log(`removing sitemap ${wikiName} from memory`)
        sitemap.length = 0
      }, sitemapTimeoutMs)
    }
  }

  // ---- Public API ----

  itself.start = () => {
    clearTimeout(sitemapTimeoutHandler)
    working = true
    itself.emit('working')
  }

  itself.stop = () => {
    working = false
    resetTimeout()
    itself.emit('finished')
  }

  itself.isWorking = () => working

  itself.createSitemap = async pagehandler => {
    itself.start()
    pagehandlerRef = pagehandlerRef ?? pagehandler
    try {
      sitemap = await pagehandler.pages()
      await save()
    } catch (e) {
      console.log(`createSitemap ${wikiName} : error`, e)
    }
    itself.stop()
  }

  itself.update = async (file, page) => {
    await ensureLoaded()
    itself.start()
    applyUpdate(file, page)
    scheduleSave()
  }

  itself.removePage = async file => {
    await ensureLoaded()
    itself.start()
    applyRemove(file)
    scheduleSave()
  }

  return itself
}
