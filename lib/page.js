/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */
// **page.coffee**
// Module for interacting with pages persisted on the server.
// Everything is stored using json flat files.

// #### Requires ####
// const fs = require('fs')
// const path = require('path')
// const events = require('events')
// const glob = require('glob')
//
// const async = require('async')
//
// // const random_id = require('./random_id.cjs')
// const synopsis = require('wiki-client/lib/synopsis')

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'
import events from 'node:events'

import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// Use dynamic import to load package.json from the main application's working directory
const wikiPackageImport = async () => {
  let done = false
  return new Promise(resolve => {
    import('wiki/package.json', { with: { type: 'json' } })
      .then(imported => {
        done = true
        resolve(imported.default)
      })
      .catch(e => {
        return e
      })
      .then(async () => {
        if (done) return
        const packageJsonPath = path.join(process.cwd(), 'package.json')
        const packageJsonUrl = url.pathToFileURL(packageJsonPath).href
        import(packageJsonUrl, { with: { type: 'json' } })
          .then(imported => {
            resolve(imported.default)
          })
          .catch(e => console.error('problems importing package', e))
      })
  })
}

const packageJson = await wikiPackageImport()

// import random_id from './random_id.cjs'; // Uncomment if needed
import synopsis from 'wiki-client/lib/synopsis.js' // Add correct extension if necessary

const asSlug = name =>
  name
    .replace(/\s/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '')
    .toLowerCase()

// Export a function that generates a page handler
// when called with options object.
export default argv => {
  const wikiName = new URL(argv.url).hostname

  const dbCreated = (async () => {
    try {
      await fsp.mkdir(argv.db, { recursive: true })
      await fsp.mkdir(argv.recycler, { recursive: true })
    } catch (err) {
      console.log('ERROR: problem creating page folders ', err)
    }
  })()

  // create a list of plugin pages.
  const pluginPages = new Map()

  const dependencyPlugins = Object.keys(packageJson.dependencies).filter(depend => depend.startsWith('wiki-plugin'))
  const plugins = dependencyPlugins.length
    ? dependencyPlugins
    : Object.keys(packageJson.devDependencies).filter(depend => depend.startsWith('wiki-plugin'))

  plugins.forEach(plugin => {
    const pagesPath = path.join(path.dirname(require.resolve(`${plugin}/package`)), 'pages')
    fs.readdir(pagesPath, { withFileTypes: true }, (err, entries) => {
      if (err) return
      entries.forEach(entry => {
        if (entry.isFile() && !pluginPages.has(entry.name)) {
          pluginPages.set(entry.name, { pluginName: plugin, pluginPath: entry.parentPath })
        }
      })
    })
  })

  // #### Private utility methods. ####
  
  const moveToRecycler = async(file) => {
    const slug = path.basename(file)
    const loc = path.join(argv.db, file)
    const recycleLoc = path.join(argv.recycler, slug)

    try {
      await fsp.rename(loc, recycleLoc)
      console.log(`ERROR: problem page ${loc} moved to recycler`)
    } catch (err) {
      console.log(`ERROR: moving problem page ${loc} to recycler`, err)
    }
  }

  const load_parse = async (loc, cb, annotations = {}) => {
    let page, data
    try {
      data = await fsp.readFile(loc)
    } catch (err) {
      return cb(err)
    }
    try {
      page = JSON.parse(data)
    } catch {
      moveToRecycler(loc)
      return cb(null, 'Error Parsing Page', 404)
    }

    for (const [key, val] of Object.entries(annotations)) {
      page[key] = val
    }
    cb(null, page)
  }

  // Reads and writes are async, but serially queued to avoid race conditions.
  const queue = []

  const tryDefaults = (file, cb) => {
    const lastDefault = cb => {
      const defloc = path.join(argv.root, 'default-data', 'pages', file)
      fs.access(defloc, fs.constants.F_OK, err => {
        if (!err) {
          cb(defloc)
        } else {
          cb(null)
        }
      })
    }
    if (argv.defaults) {
      const defloc = path.join(argv.data, '..', argv.defaults, 'pages', file)
      fs.access(defloc, fs.constants.F_OK, err => {
        if (!err) {
          cb(defloc)
        } else {
          lastDefault(cb)
        }
      })
    } else {
      lastDefault(cb)
    }
  }

  // Main file io function, when called without page it reads,
  // when called with page it writes.
  const fileio = async (action, file, page, cb) => {
    await dbCreated
    const loc = file.startsWith('recycler/') ? path.join(argv.recycler, file.split('/')[1]) : path.join(argv.db, file)

    switch (action) {
      case 'delete':
        if (file.startsWith('recycler/')) {
          // delete from recycler
          fs.unlink(loc, err => {
            cb(err)
          })
        } else {
          // move page to recycler
          fs.access(loc, fs.constants.F_OK, async (err) => {
            if (!err) {
              const recycleLoc = path.join(argv.recycler, file)
              fs.rename(loc, recycleLoc, err => {
                cb(err)
              })
            } else {
              cb('page does not exist')
            }
          })
        }
        break
      case 'recycle': {
        fs.access(loc, fs.constants.F_OK, async (err) => {
          if (!err) {
            const recycleLoc = path.join(argv.recycler, file)
            try {
              await fsp.copyFile(loc, recycleLoc)
              cb()
            } catch (err) {
              cb(err)
            }
          } else {
            cb('page does not exist')
          }
        })
        break
      }
      case 'get':
        fs.access(loc, fs.constants.F_OK, err => {
          if (!err) {
            load_parse(loc, cb, { plugin: undefined })
          } else {
            tryDefaults(file, defloc => {
              if (defloc) {
                load_parse(defloc, cb)
              } else {
                if (pluginPages.has(file)) {
                  const { pluginName, pluginPath } = pluginPages.get(file)
                  load_parse(path.join(pluginPath, file), cb, { plugin: pluginName.slice(12) })
                } else {
                  cb(null, 'Page not found', 404)
                }
              }
            })
          }
        })
        break
      case 'put':
        try {
          page = JSON.stringify(page, null, 2)
          await fsp.writeFile(loc, page)
          cb()
        } catch (err) {
          console.log(`ERROR: write file ${loc} `, err)
          cb(err)
        }
        break
      default:
        console.log(`pagehandler: unrecognized action ${action}`)
    }
  }

  // Control variable that tells if the serial queue is currently working.
  // Set back to false when all jobs are complete.
  let working = false

  // Keep file io working on queued jobs, but don't block the main thread.
  const serial = item => {
    if (item) {
      itself.start()
      fileio(item.action, item.file, item.page, (err, data, status) => {
        process.nextTick(() => {
          serial(queue.shift())
        })
        item.cb(err, data, status)
      })
    } else {
      itself.stop()
    }
  }

  // #### Public stuff ####
  // Make the exported object an instance of EventEmitter
  // so other modules can tell if it is working or not.
  const itself = new events.EventEmitter()

  itself.start = () => {
    working = true
    itself.emit('working')
  }

  itself.stop = () => {
    working = false
    itself.emit('finished')
  }

  itself.isWorking = () => working

  // get method takes a slug and a callback, adding them to the queue,
  // starting serial if it isn't already working.
  itself.get = (file, cb) => {
    queue.push({ action: 'get', file, page: null, cb })
    if (!working) serial(queue.shift())
  }

  // put takes a slugged name, the page as a json object, and a callback.
  // adds them to the queue, and starts it unless it is working.
  itself.put = (file, page, cb) => {
    queue.push({ action: 'put', file, page, cb })
    if (!working) serial(queue.shift())
  }

  itself.delete = (file, cb) => {
    queue.push({ action: 'delete', file, page: null, cb })
    if (!working) serial(queue.shift())
  }

  itself.saveToRecycler = (file, cb) => {
    queue.push({ action: 'recycle', file, page: null, cb })
    if (!working) serial(queue.shift())
  }

  const editDate = journal => {
    if (!journal) return undefined
    // find the last journal entry, that is not a fork, with a date.
    const last = journal.findLast(action => {
      return action.date && action.type != 'fork'
    })
    return last ? last.date : undefined
  }

  itself.pages = async cb => {
    await dbCreated
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

    fs.readdir(argv.db, (e, files) => {
      if (e) return cb(e)
      const doSitemap = async file => {
        return new Promise(resolve => {
          itself.get(file, (e, page, status) => {
            if (file.match(/^\./)) return resolve(null)
            if (e || status === 404) {
              console.log('Problem building sitemap:', file, 'e: ', e, 'status:', status)
              return resolve(null) // Ignore errors in the pagehandler get.
            }
            let pageLinksMap
            try {
              pageLinksMap = page.story.reduce(extractPageLinks, new Map())
            } catch (err) {
              console.log(`METADATA *** ${wikiName} reduce to extract links on ${file} failed`, err.message)
              pageLinksMap = []
            }
            //
            const pageLinks = pageLinksMap.size > 0 ? Object.fromEntries(pageLinksMap) : undefined

            resolve({
              slug: file,
              title: page.title,
              date: editDate(page.journal),
              synopsis: synopsis(page),
              links: pageLinks,
            })
          })
        })
      }

      Promise.all(files.map(doSitemap))
        .then(sitemap => {
          cb(
            null,
            sitemap.filter(item => item != null),
          )
        })
        .catch(e => cb(e))
    })
  }

  itself.slugs = async cb => {
    await dbCreated
    fs.readdir(argv.db, { withFileTypes: true }, (e, files) => {
      if (e) {
        console.log('Problem reading pages directory', e)
        return cb(e)
      }

      const onlyFiles = files.map(i => (i.isFile() ? i.name : null)).filter(i => i != null && !i?.startsWith('.'))
      cb(null, onlyFiles)
    })
  }

  itself.rawGet = async slug => {
    await dbCreated
    return fsp.readFile(path.join(argv.db, slug))
  }

  return itself
}
