/*
 * Federated Wiki : Node Server
 *
 * Page CRUD routes: JSON get/put/delete, action processing, recycler.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { PageNotFoundError } from '../errors.js'

export default ({ app, pagehandler, sitemaphandler, searchhandler, securityhandler, authorized, cors, log, argv }) => {

  const remoteGet = async (remote, slug) => {
    const remoteURL = new URL(`http://${remote}/${slug}.json`).toString()
    const res = await fetch(remoteURL, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) throw new Error(res.statusText)
    return res.json()
  }

  // ---- JSON page routes ----

  app.get(/^\/([a-z0-9-]+)\.json$/, cors, async (req, res) => {
    try {
      const page = await pagehandler.get(req.params[0])
      res.status(200).send(page)
    } catch (e) {
      if (e instanceof PageNotFoundError) return res.status(404).send(e.message)
      res.e(e)
    }
  })

  app.get(/^\/remote\/([a-zA-Z0-9:.-]+)\/([a-z0-9-]+)\.json$/, async (req, res) => {
    try {
      const page = await remoteGet(req.params[0], req.params[1])
      res.status(200).send(page)
    } catch (e) {
      log('remoteGet error:', e)
      res.e(e)
    }
  })

  // ---- Page actions ----

  app.put(/^\/page\/([a-z0-9-]+)\/action$/i, authorized, async (req, res) => {
    const action = JSON.parse(req.body.action)
    const slug = req.params[0]

    const applyAction = async page => {
      try {
        page.story = (() => {
          switch (action.type) {
            case 'move':
              return action.order.map(id => {
                const match = page.story.filter(p => id === p.id)[0]
                if (!match) throw 'Ignoring move. Try reload.'
                return match
              })
            case 'add': {
              const idx = page.story.map(p => p.id).indexOf(action.after) + 1
              page.story.splice(idx, 0, action.item)
              return page.story
            }
            case 'remove':
              return page.story.filter(p => p?.id !== action.id)
            case 'edit':
              return page.story.map(p => (p.id === action.id ? action.item : p))
            case 'create':
            case 'fork':
              return page.story || []
            default:
              log('Unfamiliar action:', action)
              throw 'Unfamiliar action ignored'
          }
        })()
      } catch (e) {
        return res.e(e)
      }

      if (!page.journal) page.journal = []
      if (action.fork) {
        page.journal.push({ type: 'fork', site: action.fork, date: action.date - 1 })
        delete action.fork
      }
      page.journal.push(action)

      try {
        await pagehandler.put(slug, page)
        res.send('ok')
      } catch (e) {
        return res.e(e)
      }

      sitemaphandler.update(slug, page).catch(e => console.log(`sitemap update error for ${slug}:`, e))
      searchhandler.update(slug, page).catch(e => console.log(`search update error for ${slug}:`, e))
    }

    try {
      if (action.fork) {
        try {
          await pagehandler.saveToRecycler(slug)
        } catch (err) {
          if (!(err instanceof PageNotFoundError)) {
            console.log(`Error saving ${slug} before fork: ${err}`)
          }
        }
        if (action.forkPage) {
          const forkPageCopy = JSON.parse(JSON.stringify(action.forkPage))
          delete action.forkPage
          await applyAction(forkPageCopy)
        } else {
          const page = await remoteGet(action.fork, slug)
          await applyAction(page)
        }
      } else if (action.type === 'create') {
        const itemCopy = JSON.parse(JSON.stringify(action.item))
        let pageExists = true
        try {
          await pagehandler.get(slug)
        } catch (e) {
          if (e instanceof PageNotFoundError) pageExists = false
          else throw e
        }
        if (pageExists) {
          res.status(409).send('Page already exists.')
        } else {
          await applyAction(itemCopy)
        }
      } else if (action.type === 'fork') {
        try {
          await pagehandler.saveToRecycler(slug)
        } catch (err) {
          console.log(`Error saving ${slug} before fork: ${err}`)
        }
        if (action.forkPage) {
          const forkPageCopy = JSON.parse(JSON.stringify(action.forkPage))
          delete action.forkPage
          await applyAction(forkPageCopy)
        } else {
          const page = await remoteGet(action.site, slug)
          await applyAction(page)
        }
      } else {
        const page = await pagehandler.get(slug)
        await applyAction(page)
      }
    } catch (e) {
      if (e instanceof PageNotFoundError) return res.e(e.message, 404)
      res.e(e)
    }
  })

  // ---- Delete ----

  app.delete(/^\/([a-z0-9-]+)\.json$/, authorized, async (req, res) => {
    const slug = req.params[0]
    try {
      await pagehandler.delete(slug)
      sitemaphandler.removePage(slug).catch(e => console.log(`sitemap remove error for ${slug}:`, e))
      searchhandler.removePage(slug).catch(e => console.log(`search remove error for ${slug}:`, e))
      res.status(200).send('')
    } catch (err) {
      res.status(500).send(err.message || err)
    }
  })

  // ---- Recycler ----

  const recyclerFavLoc = path.join(argv.root, 'default-data', 'status', 'recycler.png')
  app.get('/recycler/favicon.png', authorized, (req, res) => {
    res.sendFile(recyclerFavLoc, { dotfiles: 'allow' })
  })

  app.get('/recycler/system/slugs.json', authorized, async (req, res) => {
    try {
      const files = await fsp.readdir(argv.recycler)
      const results = await Promise.all(
        files.map(async file => {
          try {
            const page = await pagehandler.get('recycler/' + file)
            return { slug: file, title: page.title }
          } catch (e) {
            if (e instanceof PageNotFoundError) return null
            console.log('Problem building recycler map:', file, 'e:', e)
            return null
          }
        }),
      )
      res.send(results.filter(Boolean))
    } catch (e) {
      res.e(e)
    }
  })

  app.get(/^\/recycler\/([a-z0-9-]+)\.json$/, authorized, async (req, res) => {
    try {
      const page = await pagehandler.get('recycler/' + req.params[0])
      res.status(200).send(page)
    } catch (e) {
      if (e instanceof PageNotFoundError) return res.status(404).send(e.message)
      res.e(e)
    }
  })

  app.delete(/^\/recycler\/([a-z0-9-]+)\.json$/, authorized, async (req, res) => {
    try {
      await pagehandler.delete('recycler/' + req.params[0])
      res.status(200).send('')
    } catch (err) {
      res.status(500).send(err.message || err)
    }
  })
}
