/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

// **page.js**
// Module for interacting with pages persisted on the server.
// Uses per-slug promise chaining to serialize I/O on the same page
// while allowing concurrent access to different pages.
//
// All public methods return promises.
// get() throws PageNotFoundError when a page does not exist.

import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createRequire } from 'node:module'
import writeFileAtomic from 'write-file-atomic'

import { asSlug, lastEdit, extractPageLinks, synopsis } from './utils.js'
import { PageNotFoundError } from './errors.js'

const require = createRequire(import.meta.url)

const writeAtomic = (loc, data) =>
  new Promise((resolve, reject) => writeFileAtomic(loc, data, err => (err ? reject(err) : resolve())))

const copyFile = async (source, target) => {
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await pipeline(fs.createReadStream(source), fs.createWriteStream(target))
}

const exists = async loc => {
  try {
    await fsp.access(loc)
    return true
  } catch {
    return false
  }
}

export default argv => {
  const wikiName = new URL(argv.url).hostname
  const packageJson = JSON.parse(fs.readFileSync(argv.packageFile, 'utf8'))

  fs.mkdirSync(argv.db, { recursive: true })

  // Per-slug promise chain
  const locks = new Map()

  const withLock = (slug, fn) => {
    const key = slug.startsWith('recycler/') ? slug : `page:${slug}`
    const prev = locks.get(key) || Promise.resolve()
    const next = prev.then(fn, fn)
    locks.set(key, next)
    next.then(
      () => {
        if (locks.get(key) === next) locks.delete(key)
      },
      () => {
        if (locks.get(key) === next) locks.delete(key)
      },
    )
    return next
  }

  // Plugin pages
  const pluginPages = new Map()

  const initPluginPages = async () => {
    const plugins = Object.keys(packageJson.dependencies).filter(d => d.startsWith('wiki-plugin'))
    for (const plugin of plugins) {
      try {
        const pagesPath = path.join(path.dirname(require.resolve(`${plugin}/package`)), 'pages')
        const entries = await fsp.readdir(pagesPath, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isFile() && !pluginPages.has(entry.name)) {
            pluginPages.set(entry.name, {
              pluginName: plugin,
              pluginPath: entry.parentPath,
            })
          }
        }
      } catch {
        // plugin has no pages directory
      }
    }
  }

  const pluginPagesReady = initPluginPages()

  // ---- Private helpers ----

  const loadParse = async (loc, annotations = {}) => {
    const data = await fsp.readFile(loc, 'utf8')
    let page
    try {
      page = JSON.parse(data)
    } catch {
      const file = path.basename(loc)
      const dir = path.dirname(loc)
      const recycleLoc = path.resolve(dir, '..', 'recycle', file)
      try {
        await fsp.mkdir(path.dirname(recycleLoc), { recursive: true })
        await fsp.rename(loc, recycleLoc)
        console.log(`ERROR: problem page ${loc} moved to recycler`)
      } catch (moveErr) {
        console.log(`ERROR: moving problem page ${loc} to recycler`, moveErr)
      }
      throw new PageNotFoundError(loc)
    }
    for (const [key, val] of Object.entries(annotations)) {
      page[key] = val
    }
    return page
  }

  const tryDefaults = async file => {
    if (argv.defaults) {
      const defloc = path.join(argv.data, '..', argv.defaults, 'pages', file)
      if (await exists(defloc)) return defloc
    }
    const defloc = path.join(argv.root, 'default-data', 'pages', file)
    if (await exists(defloc)) return defloc
    return null
  }

  const locFor = file =>
    file.startsWith('recycler/') ? path.join(argv.recycler, file.split('/')[1]) : path.join(argv.db, file)

  // ---- Core I/O ----

  const doGet = async file => {
    const loc = locFor(file)
    if (await exists(loc)) {
      return loadParse(loc, { plugin: undefined })
    }
    const defloc = await tryDefaults(file)
    if (defloc) {
      return loadParse(defloc)
    }
    await pluginPagesReady
    if (pluginPages.has(file)) {
      const { pluginName, pluginPath } = pluginPages.get(file)
      return loadParse(path.join(pluginPath, file), {
        plugin: pluginName.slice(12),
      })
    }
    throw new PageNotFoundError(file)
  }

  const doPut = async (file, page) => {
    const loc = locFor(file)
    await fsp.mkdir(path.dirname(loc), { recursive: true })
    await writeAtomic(loc, JSON.stringify(page, null, 2))
  }

  const doDelete = async file => {
    const loc = locFor(file)
    if (file.startsWith('recycler/')) {
      if (await exists(loc)) await fsp.unlink(loc)
      return
    }
    if (!(await exists(loc))) throw new PageNotFoundError(file)
    const recycleLoc = path.join(argv.recycler, file)
    await fsp.mkdir(path.dirname(recycleLoc), { recursive: true })
    await fsp.rename(loc, recycleLoc)
  }

  const doRecycle = async file => {
    const loc = locFor(file)
    if (!(await exists(loc))) throw new PageNotFoundError(file)
    const recycleLoc = path.join(argv.recycler, file)
    await copyFile(loc, recycleLoc)
  }

  // ---- Public API ----

  const itself = {}

  itself.get = file => withLock(file, () => doGet(file))

  itself.put = (file, page) => withLock(file, () => doPut(file, page))

  itself.delete = file => withLock(file, () => doDelete(file))

  itself.saveToRecycler = file => withLock(file, () => doRecycle(file))

  itself.pages = async () => {
    const files = await fsp.readdir(argv.db)
    const results = await Promise.all(
      files
        .filter(f => !f.startsWith('.'))
        .map(async file => {
          try {
            const page = await itself.get(file)
            let pageLinksMap
            try {
              pageLinksMap = page.story.reduce(extractPageLinks, new Map())
            } catch (err) {
              console.log(`METADATA *** ${wikiName} reduce to extract links on ${file} failed`, err.message)
              pageLinksMap = new Map()
            }
            return {
              slug: file,
              title: page.title,
              date: lastEdit(page.journal),
              synopsis: synopsis(page),
              links: pageLinksMap.size > 0 ? Object.fromEntries(pageLinksMap) : undefined,
            }
          } catch (err) {
            if (err instanceof PageNotFoundError) return null
            console.log('Problem building sitemap:', file, 'e:', err)
            return null
          }
        }),
    )
    return results.filter(Boolean)
  }

  itself.slugs = async () => {
    const entries = await fsp.readdir(argv.db, { withFileTypes: true })
    return entries.filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name)
  }

  return itself
}
