/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

// **sitemap.coffee**
import fs from 'node:fs'
import path from 'node:path'
import events from 'node:events'
import writeFileAtomic from 'write-file-atomic'
import xml2js from 'xml2js'

import synopsis from 'wiki-client/lib/synopsis.js' // Add .js if needed

const asSlug = name =>
  name
    .replace(/\s/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '')
    .toLowerCase()

export default argv => {
  const wikiName = new URL(argv.url).hostname

  let sitemap = []

  const queue = []

  let sitemapPageHandler = null

  // ms since last update we will remove sitemap from memory
  const sitemapTimeoutMs = 120000
  let sitemapTimeoutHandler = null

  const sitemapLoc = path.join(argv.status, 'sitemap.json')
  const xmlSitemapLoc = path.join(argv.status, 'sitemap.xml')

  let working = false

  const lastEdit = journal => {
    if (!journal) return undefined
    // find the last journal entry, that is not a fork, with a date.
    const last = journal.findLast(action => {
      return action.date && action.type != 'fork'
    })
    return last ? last.date : undefined
  }

  const sitemapUpdate = (file, page, cb) => {
    let pageLinks, pageLinksMap
    const extractPageLinks = (collaborativeLinks, currentItem, currentIndex, array) => {
      // extract collaborative links
      // - this will need extending if we also extract the id of the item containing the link
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
          `METADATA *** ${wikiName} Error extracting links from ${currentIndex} of ${JSON.stringify(array)}`,
          err.message,
        )
      }
      return collaborativeLinks
    }
    try {
      pageLinksMap = page.story.reduce(extractPageLinks, new Map())
    } catch (err) {
      console.log(`METADATA *** ${wikiName} reduce to extract links on ${file} failed`, err.message)
      pageLinksMap = []
    }
    //
    if (pageLinksMap.size > 0) {
      pageLinks = Object.fromEntries(pageLinksMap)
    } else {
      pageLinks = undefined
    }

    const entry = {
      slug: file,
      title: page.title,
      date: lastEdit(page.journal),
      synopsis: synopsis(page),
      links: pageLinks,
    }

    const slugs = sitemap.map(page => page.slug)

    const idx = slugs.indexOf(file)

    if (~idx) {
      sitemap[idx] = entry
    } else {
      sitemap.push(entry)
    }
    cb()
  }

  const sitemapRemovePage = (file, cb) => {
    const slugs = sitemap.map(page => page.slug)
    const idx = slugs.indexOf(file)

    if (~idx) {
      sitemap.splice(idx, 1)
    }
    cb()
  }

  const sitemapSave = (sitemap, cb) => {
    fs.exists(argv.status, exists => {
      if (exists) {
        writeFileAtomic(sitemapLoc, JSON.stringify(sitemap), e => {
          if (e) return cb(e)
          cb()
        })
      } else
        fs.mkdir(argv.status, { recursive: true }, () => {
          writeFileAtomic(sitemapLoc, JSON.stringify(sitemap), e => {
            if (e) return cb(e)
            cb()
          })
        })
    })
  }

  const sitemapRestore = cb => {
    fs.exists(sitemapLoc, exists => {
      if (exists) {
        fs.readFile(sitemapLoc, (err, data) => {
          if (err) return cb(err)
          try {
            sitemap = JSON.parse(data)
          } catch (e) {
            return cb(e)
          }
          process.nextTick(() => {
            serial(queue.shift())
          })
        })
      } else {
        // sitemap file does not exist, so needs creating
        itself.createSitemap(sitemapPageHandler)
      }
    })
  }

  const xmlSitemapSave = (sitemap, cb) => {
    const xmlmapPages = []
    sitemap.forEach(page => {
      const result = {}
      result['loc'] = argv.url + '/' + page.slug + '.html'
      if (page.date) {
        const date = new Date(page.date)
        if (!isNaN(date.valueOf())) {
          result['lastmod'] = date.toISOString().substring(0, 10)
        }
      }
      xmlmapPages.push(result)
    })
    const xmlmap = { urlset: { $: { xmlns: 'http://www.sitemaps.org/schemas/sitemap/0.9' }, url: xmlmapPages } }
    const builder = new xml2js.Builder()
    const xml = builder.buildObject(xmlmap)
    fs.exists(argv.status, exists => {
      if (exists) {
        writeFileAtomic(xmlSitemapLoc, xml, e => {
          if (e) return cb(e)
          cb()
        })
      } else {
        fs.mkdir(argv.status, { recursive: true }, () => {
          writeFileAtomic(xmlSitemapLoc, xml, e => {
            if (e) return cb(e)
            cb()
          })
        })
      }
    })
  }

  const serial = item => {
    if (item) {
      switch (item.action) {
        case 'update':
          itself.start()
          sitemapUpdate(item.file, item.page, e => process.nextTick(() => serial(queue.shift())))
          break
        case 'remove':
          itself.start()
          sitemapRemovePage(item.file, e => process.nextTick(() => serial(queue.shift())))
          break
        default:
          console.log(`Sitemap unexpected action ${item.action} for ${item.page} in ${wikiName}`)
          process.nextTick(() => serial(queue.shift))
      }
    } else
      sitemapSave(sitemap, e => {
        if (e) console.log(`Problems saving sitemap ${wikiName}: ` + e)
        itself.stop()
      })
    xmlSitemapSave(sitemap, e => {
      if (e) console.log(`Problems saving sitemap(xml) ${wikiName}`) + e
    })
  }

  // #### Public stuff ####

  const itself = new events.EventEmitter()
  itself.start = () => {
    clearTimeout(sitemapTimeoutHandler)
    working = true
    itself.emit('working')
  }
  itself.stop = () => {
    const clearsitemap = () => {
      console.log(`removing sitemap ${wikiName} from memory`)
      sitemap.length = 0
      clearTimeout(sitemapTimeoutHandler)
    }
    // don't clear sitemap when in test environment. It just delays the tests completing.
    if (!argv.test) sitemapTimeoutHandler = setTimeout(clearsitemap, sitemapTimeoutMs)
    working = false
    itself.emit('finished')
  }
  itself.isWorking = () => {
    working
  }

  itself.createSitemap = pagehandler => {
    itself.start()
    // we save the pagehandler, so we can recreate the sitemap if it is removed
    if (!sitemapPageHandler) sitemapPageHandler = pagehandler

    pagehandler.pages((e, newsitemap) => {
      if (e) {
        console.log(`createSitemap ${wikiName} : error ` + e)
        itself.stop()
        return e
      }
      sitemap = newsitemap

      process.nextTick(() => {
        serial(queue.shift())
      })
    })
  }

  itself.removePage = file => {
    const action = 'remove'
    queue.push({ action, file })
    if (sitemap.length === 0 && !working) {
      itself.start()
      sitemapRestore(e => {
        if (e) console.log(`Problems restoring sitemap ${wikiName} : ` + e)
        itself.createSitemap(sitemapPageHandler)
      })
    } else {
      if (!working) serial(queue.shift())
    }
  }

  itself.update = (file, page) => {
    const action = 'update'
    queue.push({ action, file, page })
    if (sitemap.length === 0 && !working) {
      itself.start()
      sitemapRestore(e => {
        if (e) console.log(`Problems restoring sitemap ${wikiName} : ` + e)
        itself.createSitemap(sitemapPageHandler)
      })
    } else {
      if (!working) serial(queue.shift())
    }
  }

  return itself
}
