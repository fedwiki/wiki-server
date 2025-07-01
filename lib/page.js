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
const fs = require('fs')
const path = require('path')
const events = require('events')
const glob = require('glob')

const async = require('async')

const random_id = require('./random_id')
const synopsis = require('wiki-client/lib/synopsis')

const asSlug = name =>
  name
    .replace(/\s/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '')
    .toLowerCase()

// Export a function that generates a page handler
// when called with options object.
module.exports = exports = argv => {
  const wikiName = new URL(argv.url).hostname

  fs.mkdir(argv.db, { recursive: true }, e => {
    if (e) throw e
  })

  // #### Private utility methods. ####
  const load_parse = (loc, cb, annotations = {}) => {
    let page
    fs.readFile(loc, (err, data) => {
      if (err) return cb(err)
      try {
        page = JSON.parse(data)
      } catch {
        const errorPage = path.basename(loc)
        const errorPagePath = path.dirname(loc)
        const recyclePage = path.resolve(errorPagePath, '..', 'recycle', errorPage)
        fs.access(path.dirname(recyclePage), fs.constants.F_OK, err => {
          if (!err) {
            fs.rename(loc, recyclePage, err => {
              if (err) {
                console.log(`ERROR: moving problem page ${loc} to recycler`, err)
              } else {
                console.log(`ERROR: problem page ${loc} moved to recycler`)
              }
            })
          } else {
            fs.mkdir(path.dirname(recyclePage), { recursive: true }, err => {
              if (err) {
                console.log('ERROR: creating recycler', err)
              } else {
                fs.rename(loc, recyclePage, err => {
                  if (err) {
                    console.log(`ERROR: moving problem page ${loc} to recycler`, err)
                  } else {
                    console.log(`ERROR: problem page ${loc} moved to recycler`)
                  }
                })
              }
            })
          }
        })

        return cb(null, 'Error Parsing Page', 404)
      }
      for (const [key, val] of Object.entries(annotations)) {
        page[key] = val
      }
      cb(null, page)
    })
  }

  const load_parse_copy = (defloc, file, cb) => {
    fs.readFile(defloc, (err, data) => {
      if (err) cb(err)
      let page
      try {
        page = JSON.parse(data)
      } catch (e) {
        return cb(e)
      }
      cb(null, page)
      // TODO: what is happening here?! put will never be reached???
      itself.put(file, page, err => {
        if (err) cb(err)
      })
    })
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
  const fileio = (action, file, page, cb) => {
    const loc = file.startsWith('recycler/') ? path.join(argv.recycler, file.split('/')[1]) : path.join(argv.db, file)

    switch (action) {
      case 'delete':
        if (file.startsWith('recycler/')) {
          // delete from recycler
          fs.access(loc, fs.constants.F_OK, err => {
            if (!err)
              fs.unlink(loc, err => {
                cb(err)
              })
          })
        } else {
          // move page to recycler
          fs.access(loc, fs.constants.F_OK, err => {
            if (!err) {
              const recycleLoc = path.join(argv.recycler, file)
              fs.access(path.dirname(recycleLoc), fs.constants.F_OK, err => {
                if (!err) {
                  fs.rename(loc, recycleLoc, err => {
                    cb(err)
                  })
                } else {
                  fs.mkdir(path.dirname(recycleLoc), { recursive: true }, err => {
                    if (err) cb(err)
                    fs.rename(loc, recycleLoc, err => {
                      cb(err)
                    })
                  })
                }
              })
            } else {
              cb('page does not exist')
            }
          })
        }
        break
      case 'recycle': {
        const copyFile = (source, target, cb) => {
          const done = err => {
            if (!cbCalled) {
              cb(err)
              cbCalled = true
            }
            return
          }

          let cbCalled = false

          const rd = fs.createReadStream(source)
          rd.on('error', err => {
            done(err)
            return
          })

          const wr = fs.createWriteStream(target)
          wr.on('error', err => {
            done(err)
            return
          })
          wr.on('close', () => {
            done()
            return
          })
          rd.pipe(wr)
          return
        }

        fs.access(loc, fs.constants.F_OK, err => {
          if (!err) {
            const recycleLoc = path.join(argv.recycler, file)
            fs.access(path.dirname(recycleLoc), fs.constants.F_OK, err => {
              if (!err) {
                copyFile(loc, recycleLoc, err => {
                  cb(err)
                })
              } else {
                fs.mkdir(path.dirname(recycleLoc), { recursive: true }, err => {
                  if (err) cb(err)
                  copyFile(loc, recycleLoc, err => {
                    cb(err)
                  })
                })
              }
            })
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
                glob('wiki-plugin-*/pages', { cwd: argv.packageDir }, (e, plugins) => {
                  if (e) return cb(e)

                  // if no plugins found
                  if (plugins.length === 0) {
                    cb(null, 'Page not found', 404)
                  }

                  let count = plugins.length
                  const giveUp = () => {
                    count -= 1
                    if (count === 0) {
                      cb(null, 'Page not found', 404)
                    }
                  }
                  plugins.forEach(plugin => {
                    const pluginName = plugin.slice(12, -6)
                    const pluginloc = path.join(argv.packageDir, plugin, file)
                    fs.access(pluginloc, fs.constants.F_OK, err => {
                      if (!err) {
                        load_parse(pluginloc, cb, { plugin: pluginName })
                      } else {
                        giveUp()
                      }
                    })
                  })
                })
              }
            })
          }
        })
        break
      case 'put':
        page = JSON.stringify(page, null, 2)
        fs.access(path.dirname(loc), fs.constants.F_OK, err => {
          if (!err) {
            fs.writeFile(loc, page, err => {
              if (err) {
                console.log(`ERROR: write file ${loc} `, err)
              }
              cb(err)
            })
          } else {
            fs.mkdir(path.dirname(loc), { recursive: true }, err => {
              if (err) cb(err)
              fs.writeFile(loc, page, err => {
                if (err) {
                  console.log(`ERROR: write file ${loc} `, err)
                }
                cb(err)
              })
            })
          }
        })
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

  itself.pages = cb => {
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
      // used to make sure all of the files are read
      // and processesed in the site map before responding
      const doSitemap = (file, cb) => {
        itself.get(file, (e, page, status) => {
          if (file.match(/^\./)) return cb()
          if (e || status === 404) {
            console.log('Problem building sitemap:', file, 'e: ', e, 'status:', status)
            return cb() // Ignore errors in the pagehandler get.
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

          cb(null, {
            slug: file,
            title: page.title,
            date: editDate(page.journal),
            synopsis: synopsis(page),
            links: pageLinks,
          })
        })
      }
      async.map(files, doSitemap, (e, sitemap) => {
        if (e) return cb(e)
        cb(
          null,
          sitemap.filter(item => item != null),
        )
      })
    })
  }

  itself.slugs = cb => {
    fs.readdir(argv.db, { withFileTypes: true }, (e, files) => {
      if (e) {
        console.log('Problem reading pages directory', e)
        return cb(e)
      }

      const onlyFiles = files.map(i => (i.isFile() ? i.name : null)).filter(i => i != null && !i?.startsWith('.'))
      cb(null, onlyFiles)
    })
  }

  return itself
}
