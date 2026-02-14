/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

// **search.js**
// Maintains a MiniSearch full-text index of all wiki pages.
//
// In-memory mutations (update/remove) are synchronous against the
// MiniSearch instance. Persistence is debounced — rapid successive
// edits coalesce into a single file write.

import fsp from 'node:fs/promises'
import path from 'node:path'
import events from 'node:events'
import writeFileAtomic from 'write-file-atomic'
import miniSearch from 'minisearch'
import { PageNotFoundError } from './errors.js'

const writeAtomic = (loc, data) =>
  new Promise((resolve, reject) =>
    writeFileAtomic(loc, data, err => (err ? reject(err) : resolve()))
  )

export default argv => {
  const wikiName = new URL(argv.url).hostname

  let siteIndex = null // miniSearch instance, or null when not loaded
  let pagehandlerRef = null

  const siteIndexLoc = path.join(argv.status, 'site-index.json')
  const indexUpdateFlag = path.join(argv.status, 'index-updated')

  const searchTimeoutMs = 120000
  let searchTimeoutHandler = null

  let working = false
  let dirty = false
  let saveTimer = null
  const SAVE_DELAY_MS = 100

  const itself = new events.EventEmitter()

  // ---- Text extraction ----

  const extractItemText = text =>
    text
      .replace(/\[([^\]]*?)\][[(].*?[\])]/g, ' $1 ')
      .replace(/\[{2}|\[(?:[\S]+)|\]{1,2}/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/<style.*?<\/style>/g, ' ')
      .replace(/<(?:"[^"]*"['"]*|'[^']*'['"]*|[^'">])+>/g, ' ')
      .replace(/<(?:[^>])+>/g, ' ')
      .replace(/(https?:.*?)(?=\p{White_Space}|\p{Quotation_Mark}|$)/gu, match => {
        try {
          return new URL(match).hostname
        } catch {
          return ' '
        }
      })
      .replace(/[\p{P}\p{Emoji}\p{Symbol}}]+/gu, ' ')
      .replace(/[\p{White_Space}\n\t]+/gu, ' ')

  const extractableTypes = new Set([
    'paragraph', 'markdown', 'html', 'reference',
    'image', 'pagefold', 'math', 'mathjax', 'code',
  ])

  const mediaTypes = new Set(['audio', 'video', 'frame'])

  const extractMediaText = text =>
    text
      .split(/\r\n?|\n/)
      .map(line => {
        const first = line.split(/\p{White_Space}/u)[0]
        if (first.startsWith('http') || first.toUpperCase() === first || first.startsWith('//')) {
          return ''
        }
        return line
      })
      .join(' ')

  const extractPageText = (pageText, item) => {
    try {
      if (!item.text) return pageText
      if (extractableTypes.has(item.type)) {
        return pageText + ' ' + extractItemText(item.text)
      }
      if (mediaTypes.has(item.type)) {
        return pageText + ' ' + extractItemText(extractMediaText(item.text))
      }
    } catch (err) {
      console.log(`SITE INDEX *** Error extracting text from item`, err.message)
    }
    return pageText
  }

  const pageToDoc = (slug, page) => {
    let content = ''
    try {
      content = page.story.reduce(extractPageText, '')
    } catch (err) {
      console.log(`SITE INDEX *** ${wikiName} text extraction on ${slug} failed`, err.message)
    }
    return { id: slug, title: page.title, content }
  }

  // ---- Index helpers ----

  const newIndex = () =>
    new miniSearch({ fields: ['title', 'content'] })

  const applyUpdate = (slug, page) => {
    if (!siteIndex) return
    const doc = pageToDoc(slug, page)
    if (siteIndex.has(slug)) {
      siteIndex.replace(doc)
    } else {
      siteIndex.add(doc)
    }
  }

  const applyRemove = slug => {
    if (!siteIndex) return
    try {
      siteIndex.discard(slug)
    } catch (err) {
      if (!err.message.includes('not in the index')) {
        console.log(`removing ${slug} from index ${wikiName} failed`, err)
      }
    }
  }

  // ---- Persistence ----

  const touch = async file => {
    try {
      await fsp.stat(file)
    } catch {
      const fd = await fsp.open(file, 'w')
      await fd.close()
    }
  }

  const save = async () => {
    try {
      await fsp.mkdir(argv.status, { recursive: true })
      await writeAtomic(siteIndexLoc, JSON.stringify(siteIndex))
      await touch(indexUpdateFlag)
    } catch (e) {
      console.log('SITE INDEX *** save failed:', e)
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
      if (dirty) scheduleSave()
    }, SAVE_DELAY_MS)
  }

  const restore = async () => {
    try {
      const data = await fsp.readFile(siteIndexLoc, 'utf8')
      siteIndex = miniSearch.loadJSON(data, { fields: ['title', 'content'] })
    } catch {
      siteIndex = null
    }
  }

  const ensureLoaded = async () => {
    if (!siteIndex && !working) {
      await restore()
      if (!siteIndex && pagehandlerRef) {
        await itself.createIndex(pagehandlerRef)
      }
    }
  }

  const resetTimeout = () => {
    clearTimeout(searchTimeoutHandler)
    if (!argv.test) {
      searchTimeoutHandler = setTimeout(() => {
        console.log(`SITE INDEX ${wikiName} : removed from memory`)
        siteIndex = null
      }, searchTimeoutMs)
    }
  }

  // ---- Public API ----

  itself.start = () => {
    clearTimeout(searchTimeoutHandler)
    working = true
    itself.emit('indexing')
  }

  itself.stop = () => {
    working = false
    resetTimeout()
    itself.emit('indexed')
  }

  itself.isWorking = () => working

  itself.createIndex = async pagehandler => {
    itself.start()
    pagehandlerRef = pagehandlerRef ?? pagehandler
    try {
      const slugs = await pagehandler.slugs()
      siteIndex = newIndex()
      await Promise.all(
        slugs.map(async slug => {
          try {
            const page = await pagehandler.get(slug)
            siteIndex.add(pageToDoc(slug, page))
          } catch (err) {
            if (!(err instanceof PageNotFoundError)) {
              console.log(`SITE INDEX *** ${wikiName}: error reading page`, slug)
            }
          }
        }),
      )
      await save()
    } catch (e) {
      console.log(`SITE INDEX *** createIndex ${wikiName} error:`, e)
    }
    itself.stop()
  }

  itself.update = async (slug, page) => {
    await ensureLoaded()
    itself.start()
    applyUpdate(slug, page)
    scheduleSave()
  }

  itself.removePage = async slug => {
    await ensureLoaded()
    itself.start()
    applyRemove(slug)
    scheduleSave()
  }

  itself.startUp = async pagehandler => {
    console.log(`SITE INDEX ${wikiName} : StartUp`)
    pagehandlerRef = pagehandler

    let needsRebuild = false

    try {
      await fsp.stat(siteIndexLoc)
      // Index file exists — check if it's been flagged for update
      try {
        await fsp.stat(indexUpdateFlag)
        needsRebuild = true
      } catch {
        // No update flag — check serialization version
        try {
          const data = await fsp.readFile(siteIndexLoc, 'utf8')
          const parsed = JSON.parse(data)
          if (parsed.serializationVersion !== 2) {
            console.log(`+++ SITE INDEX ${wikiName} : updating to latest version.`)
            needsRebuild = true
          }
        } catch {
          console.log(`+++ SITE INDEX ${wikiName} : error reading index — recreating`)
          needsRebuild = true
        }
      }
    } catch {
      // Index file doesn't exist
      needsRebuild = true
    }

    if (needsRebuild) {
      await itself.createIndex(pagehandler)
      try {
        await fsp.unlink(indexUpdateFlag)
      } catch {
        // flag didn't exist, fine
      }
    }
  }

  return itself
}
