/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

// **search.js**

const fs = require('node:fs')
const path = require('node:path')
const events = require('node:events')
const url = require('node:url')
const writeFileAtomic = require('write-file-atomic')

const miniSearch = require('minisearch')

module.exports = exports = argv => {
  const wikiName = new URL(argv.url).hostname
  let siteIndex = []
  const queue = []

  let searchPageHandler = null

  // ms since last update we will remove index from memory
  // orig - searchTimeoutMs = 1200000
  const searchTimeoutMs = 120000 // temp reduce to 2 minutes
  let searchTimeoutHandler = null

  const siteIndexLoc = path.join(argv.status, 'site-index.json')
  const indexUpdateFlag = path.join(argv.status, 'index-updated')

  let working = false

  const touch = (file, cb) => {
    fs.stat(file, (err, stats) => {
      if (err === null) return cb()
      fs.open(file, 'w', (err, fd) => {
        if (err) cb(err)
        fs.close(fd, err => {
          cb(err)
        })
      })
    })
  }

  const searchPageUpdate = (slug, page, cb) => {
    // to update we have to remove the page first, and then readd it
    let pageText
    try {
      pageText = page.story.reduce(extractPageText, '')
    } catch (err) {
      console.log(`SITE INDEX *** ${wikiName} reduce to extract the text on ${slug} failed`, err.message)
      pageText = ''
    }
    if (siteIndex.has(slug)) {
      siteIndex.replace({
        id: slug,
        title: page.title,
        content: pageText,
      })
    } else {
      siteIndex.add({
        id: slug,
        title: page.title,
        content: pageText,
      })
    }
    cb()
  }

  const searchPageRemove = (slug, cb) => {
    // remove page from index
    try {
      siteIndex.discard(slug)
    } catch (err) {
      // swallow error, if the page was not in index
      if (!err.message.includes('not in the index')) {
        console.log(`removing ${slug} from index ${wikiName} failed`, err)
      }
    }
    cb()
  }

  const searchSave = (siteIndex, cb) => {
    // save index to file
    fs.access(argv.status, fs.constants.F_OK, err => {
      if (!err) {
        writeFileAtomic(siteIndexLoc, JSON.stringify(siteIndex), e => {
          if (e) return cb(e)
          touch(indexUpdateFlag, () => {
            cb()
          })
        })
      } else {
        fs.mkdir(argv.status, { recursive: true }, () => {
          writeFileAtomic(siteIndexLoc, JSON.stringify(siteIndex), e => {
            if (e) return cb(e)
            touch(indexUpdateFlag, () => {
              cb()
            })
          })
        })
      }
    })
  }

  const searchRestore = cb => {
    // restore index, or create if it doesn't already exist
    fs.access(siteIndexLoc, fs.constants.F_OK, err => {
      if (!err) {
        fs.readFile(siteIndexLoc, (err, data) => {
          if (err) return cb(err)
          try {
            siteIndex = miniSearch.loadJSON(data, {
              fields: ['title', 'content'],
            })
          } catch (e) {
            return cb(e)
          }
          process.nextTick(() => {
            serial(queue.shift())
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
          searchPageUpdate(item.slug, item.page, () => {
            process.nextTick(() => {
              serial(queue.shift())
            })
          })
          break
        case 'remove':
          itself.start()
          searchPageRemove(item.slug, () => {
            process.nextTick(() => {
              serial(queue.shift())
            })
          })
          break
        default:
          console.log(`SITE INDEX *** unexpected action ${item.action} for ${item.page}`)
          process.nextTick(() => {
            serial(queue.shift)
          })
      }
    } else {
      searchSave(siteIndex, e => {
        if (e) console.log('SITE INDEX *** save failed: ' + e)
        itself.stop()
      })
    }
  }

  const extractItemText = text => {
    return text
      .replace(/\[([^\]]*?)\][[(].*?[\])]/g, ' $1 ')
      .replace(/\[{2}|\[(?:[\S]+)|\]{1,2}/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/<style.*?<\/style>/g, ' ')
      .replace(/<(?:"[^"]*"['"]*|'[^']*'['"]*|[^'">])+>/g, ' ')
      .replace(/<(?:[^>])+>/g, ' ')
      .replace(/(https?:.*?)(?=\p{White_Space}|\p{Quotation_Mark}|$)/gu, match => {
        try {
          const myUrl = new URL(match)
          return myUrl.hostname
        } catch {
          return ' '
        }
      })
      .replace(/[\p{P}\p{Emoji}\p{Symbol}}]+/gu, ' ')
      .replace(/[\p{White_Space}\n\t]+/gu, ' ')
  }

  const extractPageText = (pageText, currentItem, currentIndex, array) => {
    // console.log('extractPageText', pageText, currentItem, currentIndex, array)
    try {
      if (currentItem.text) {
        switch (currentItem.type) {
          case 'paragraph':
          case 'markdown':
          case 'html':
          case 'reference':
          case 'image':
          case 'pagefold':
          case 'math':
          case 'mathjax':
          case 'code':
            pageText += ' ' + extractItemText(currentItem.text)
            break
          case 'audio':
          case 'video':
          case 'frame':
            pageText +=
              ' ' +
              extractItemText(
                currentItem.text
                  .split(/\r\n?|\n/)
                  .map(line => {
                    const firstWord = line.split(/\p{White_Space}/u)[0]
                    if (
                      firstWord.startsWith('http') ||
                      firstWord.toUpperCase() === firstWord ||
                      firstWord.startsWith('//')
                    ) {
                      // line is markup
                      return ''
                    } else {
                      return line
                    }
                  })
                  .join(' '),
              )
        }
      }
    } catch (err) {
      throw new Error(`Error extracting text from ${currentIndex}, ${JSON.stringify(currentItem)} ${err}, ${err.stack}`)
    }
    return pageText
  }

  // #### Public stuff ####

  var itself = new events.EventEmitter()
  itself.start = () => {
    clearTimeout(searchTimeoutHandler)
    working = true
    return itself.emit('indexing')
  }
  itself.stop = () => {
    const clearsearch = () => {
      console.log(`SITE INDEX ${wikiName} : removed from memory`)
      siteIndex = []
      clearTimeout(searchTimeoutHandler)
    }
    searchTimeoutHandler = setTimeout(clearsearch, searchTimeoutMs)
    working = false
    return itself.emit('indexed')
  }
  itself.isWorking = () => {
    return working
  }
  itself.createIndex = pagehandler => {
    itself.start()

    // we save the pagehandler, so we can recreate the site index if it is removed
    searchPageHandler = searchPageHandler ?? pagehandler

    //timeLabel = `SITE INDEX ${wikiName} : Created`
    //console.time timeLabel

    pagehandler.slugs((e, slugs) => {
      if (e) {
        console.log(`SITE INDEX *** createIndex ${wikiName} error:`, e)
        itself.stop()
        return e
      }
      siteIndex = new miniSearch({
        fields: ['title', 'content'],
      })

      const indexPromises = slugs.map(slug => {
        return new Promise(resolve => {
          pagehandler.get(slug, (err, page) => {
            if (err) {
              console.log(`SITE INDEX *** ${wikiName}: error reading page`, slug)
              return
            }
            // page
            let pageText
            try {
              pageText = page.story.reduce(extractPageText, '')
            } catch (err) {
              console.log(`SITE INDEX *** ${wikiName} reduce to extract text on ${slug} failed`, err.message)
              // console.log "page", page
              pageText = ''
            }
            siteIndex.add({
              id: slug,
              title: page.title,
              content: pageText,
            })
            resolve()
          })
        })
      })
      Promise.all(indexPromises).then(() => {
        // console.timeEnd timeLabel
        process.nextTick(() => {
          serial(queue.shift())
        })
      })
    })
  }

  itself.removePage = slug => {
    const action = 'remove'
    queue.push({ action, slug })
    if (Array.isArray(siteIndex) && !working) {
      itself.start()
      searchRestore(e => {
        if (e) console.log(`SITE INDEX *** Problems restoring search index ${wikiName}:` + e)
        itself.createIndex(searchPageHandler)
      })
    } else {
      if (!working) serial(queue.shift())
    }
  }

  itself.update = (slug, page) => {
    const action = 'update'
    queue.push({ action, slug, page })
    if (Array.isArray(siteIndex) && !working) {
      itself.start()
      searchRestore(e => {
        if (e) console.log(`SITE INDEX *** Problems restoring search index ${wikiName}:` + e)
        itself.createIndex(searchPageHandler)
      })
    } else {
      if (!working) serial(queue.shift())
    }
  }
  itself.startUp = pagehandler => {
    // called on server startup, here we check if wiki already is index
    // we only create an index if there is either no index or there have been updates since last startup
    console.log(`SITE INDEX ${wikiName} : StartUp`)
    fs.stat(siteIndexLoc, (err, stats) => {
      if (err === null) {
        // site index exists, but has it been updated?
        fs.stat(indexUpdateFlag, (err, stats) => {
          if (!err) {
            // index has been updated, so recreate it.
            itself.createIndex(pagehandler)
            // remove the update flag once the index has been created
            itself.once('indexed', () => {
              fs.unlink(indexUpdateFlag, err => {
                if (err) console.log(`+++ SITE INDEX ${wikiName} : unable to delete update flag`)
              })
            })
          } else {
            // not been updated, but is it the correct version?
            fs.readFile(siteIndexLoc, (err, data) => {
              if (!err) {
                let testIndex
                try {
                  testIndex = JSON.parse(data)
                } catch (err) {
                  testIndex = {}
                }
                if (testIndex.serializationVersion != 2)
                  console.log(`+++ SITE INDEX ${wikiName} : updating to latest version.`)
                itself.createIndex(pagehandler)
                // remove the update flag once the index has been created
                itself.once('indexed', () => {
                  fs.unlink(indexUpdateFlag, err => {
                    if (err) console.log(`+++ SITE INDEX ${wikiName} : unable to delete update flag`)
                  })
                })
              } else {
                console.log(`+++ SITE INDEX ${wikiName} : error reading index - attempting creating`)
                itself.createIndex(pagehandler)
                // remove the update flag once the index has been created
                itself.once('indexed', () => {
                  fs.unlink(indexUpdateFlag, err => {
                    if (err) console.log(`+++ SITE INDEX ${wikiName} : unable to delete update flag`)
                  })
                })
              }
            })
          }
        })
      } else {
        // index does not exist, so create it
        itself.createIndex(pagehandler)
        // remove the update flag once the index has been created
        itself.once('indexed', () => {
          fs.unlink(indexUpdateFlag, err => {
            if (err) console.log(`+++ SITE INDEX ${wikiName} : unable to delete update flag`)
          })
        })
      }
    })
  }

  return itself
}
