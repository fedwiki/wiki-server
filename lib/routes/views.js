/*
 * Federated Wiki : Node Server
 *
 * View routes: HTML page rendering, multi-page view.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { render } from '../render.js'
import { PageNotFoundError } from '../errors.js'

export default ({ app, pagehandler, securityhandler, cors, log, argv, getOwner }) => {

  const index = argv.home + '.html'

  // Multi-page view — links like /view/page-a/site.example.com/page-b
  app.get(/^((\/[a-zA-Z0-9:.-]+\/[a-z0-9-]+(_rev\d+)?)+)\/?$/, cors, (req, res, next) => {
    const urlPages = req.params[0]
      .split('/')
      .filter((_, i) => i % 2 === 0)
      .slice(1)
    const urlLocs = req.params[0]
      .split('/')
      .slice(1)
      .filter((_, i) => i % 2 === 0)
    if (['plugin', 'auth'].indexOf(urlLocs[0]) > -1) return next()
    const title = urlPages.slice().pop().replace(/-+/g, ' ')
    const user = securityhandler.getUser(req)
    const owner = getOwner()
    const info = {
      title,
      pages: [],
      authenticated: !!user,
      user,
      seedNeighbors: argv.neighbors,
      owned: !!owner,
      isOwner: !!securityhandler.isAuthorized(req),
      ownedBy: owner || '',
    }
    for (const [idx, page] of urlPages.entries()) {
      if (urlLocs[idx] === 'view') {
        info.pages.push({ page })
      } else {
        info.pages.push({ page, origin: `data-site=${urlLocs[idx]}` })
      }
    }
    res.render('static.html', info)
  })

  // Single page HTML rendering
  app.get(/^\/([a-z0-9-]+)\.html$/, cors, async (req, res, next) => {
    const slug = req.params[0]
    log(slug)
    if (slug === 'runtests') return next()
    try {
      const page = await pagehandler.get(slug)
      page.title ||= slug.replace(/-+/g, ' ')
      page.story ||= []
      const user = securityhandler.getUser(req)
      const owner = getOwner()
      const info = {
        title: page.title,
        pages: [{
          page: slug,
          generated: 'data-server-generated=true',
          story: render(page),
        }],
        authenticated: !!user,
        user,
        seedNeighbors: argv.neighbors,
        owned: !!owner,
        isOwner: !!securityhandler.isAuthorized(req),
        ownedBy: owner || '',
      }
      res.render('static.html', info)
    } catch (e) {
      if (e instanceof PageNotFoundError) return res.status(404).send(e.message)
      res.e(e)
    }
  })

  // Oops
  app.get('/oops', (req, res) => {
    res.statusCode = 403
    res.render('oops.html', { msg: 'This is not your wiki!' })
  })

  // Root redirect
  app.get('/', cors, async (req, res) => {
    const home = path.join(argv.assets, 'home', 'index.html')
    try {
      const stats = await fsp.stat(home)
      if (stats.isFile()) {
        res.redirect('/assets/home/index.html')
      } else {
        res.redirect(index)
      }
    } catch {
      res.redirect(index)
    }
  })
}
