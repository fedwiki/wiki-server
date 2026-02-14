/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import express from 'express'
import hbs from 'express-hbs'
import logger from 'morgan'
import cookieParser from 'cookie-parser'
import methodOverride from 'method-override'
import sessions from 'client-sessions'
import bodyParser from 'body-parser'
import errorHandler from 'errorhandler'

import defargs from './defaultargs.js'
import { render } from './render.js'
import pluginsFactory from './plugins.js'
import sitemapFactory from './sitemap.js'
import searchFactory from './search.js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

export default async argv => {
  const app = express()
  app.disable('x-powered-by')

  argv = defargs(argv)

  const packageJson = JSON.parse(fs.readFileSync(argv.packageFile, 'utf8'))

  app.startOpts = argv

  const wikiName = new URL(argv.url).hostname

  const log = (...stuff) => {
    if (argv.debug) console.log(stuff)
  }
  const loga = (...stuff) => {
    console.log(stuff)
  }

  const ourErrorHandler = (req, res, next) => {
    let fired = false
    res.e = (error, status) => {
      if (!fired) {
        fired = true
        res.statusCode = status || 500
        res.end('Server ' + error)
        log('Res sent:', res.statusCode, error)
      } else {
        log('Already fired', error)
      }
    }
    next()
  }

  let pagehandler, sitemaphandler, searchhandler, securityhandler

  const dbModule = await import(argv.database.type)
  app.pagehandler = pagehandler = dbModule.default(argv)

  app.sitemaphandler = sitemaphandler = sitemapFactory(argv)
  app.searchhandler = searchhandler = searchFactory(argv)

  console.log('security_type', argv.security_type)
  const securityModule = await import(argv.security_type)
  app.securityhandler = securityhandler = securityModule.default(log, loga, argv)

  let owner = ''
  let user = ''

  const updateOwner = id => {
    owner = id
  }

  const cors = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.get('origin') || '*')
    next()
  }

  const remoteGet = async (remote, slug) => {
    const remoteURL = new URL(`http://${remote}/${slug}.json`).toString()
    const res = await fetch(remoteURL, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) throw new Error(res.statusText)
    return res.json()
  }

  const staticPathOptions = {
    dotfiles: 'ignore',
    etag: true,
    immutable: false,
    lastModified: false,
    maxAge: '1h',
  }

  app.set('views', path.join(require.resolve('wiki-client/package.json'), '..', 'views'))
  app.set('view engine', 'html')
  app.engine('html', hbs.express4())
  app.set('view options', { layout: false })

  const colorString = str => {
    const colorReset = '\x1b[0m'
    let hash = 0
    str.split('').forEach(char => {
      hash = char.charCodeAt(0) + ((hash << 5) - hash)
    })
    let color = '\x1b[38;2'
    ;[...Array(3).keys()].forEach(i => {
      const value = (hash >> (i * 8)) & 0xff
      color += ':' + value.toString()
    })
    color += 'm'
    return color + str + colorReset
  }

  const vhost = colorString(wikiName)
  app.use(
    logger((tokens, req, res) => {
      return [
        vhost,
        tokens.method(req, res),
        tokens.url(req, res),
        tokens.status(req, res),
        tokens.res(req, res, 'content-length'),
        '-',
        tokens['response-time'](req, res),
        'ms',
      ].join(' ')
    }),
  )

  app.use(cookieParser())
  app.use(bodyParser.json({ limit: argv.uploadLimit }))
  app.use(bodyParser.urlencoded({ extended: true, limit: argv.uploadLimit }))
  app.use(methodOverride())

  const cookieValue = {
    httpOnly: true,
    sameSite: 'lax',
  }
  if (argv.wiki_domain) {
    if (!argv.wiki_domain.endsWith('localhost')) {
      cookieValue['domain'] = argv.wiki_domain
    }
  }
  let cookieName
  if (argv.secure_cookie) {
    cookieName = 'wikiTlsSession'
    cookieValue['secureProxy'] = true
  } else {
    cookieName = 'wikiSession'
  }
  app.use(
    sessions({
      cookieName,
      requestKey: 'session',
      secret: argv.cookieSecret,
      duration: argv.session_duration * 24 * 60 * 60 * 1000,
      activeDuration: 24 * 60 * 60 * 1000,
      cookie: cookieValue,
    }),
  )

  app.use(ourErrorHandler)
  app.use(express.static(argv.client, staticPathOptions))

  securityhandler.defineRoutes(app, cors, updateOwner)

  app.use('/assets', cors, express.static(argv.assets))

  Object.keys(packageJson.dependencies)
    .filter(depend => depend.startsWith('wiki-plugin'))
    .forEach(plugin => {
      const clientPath = path.join(path.dirname(require.resolve(`${plugin}/package`)), 'client')
      const pluginPath = '/plugins/' + plugin.slice(12)
      app.use(pluginPath, cors, express.static(clientPath, staticPathOptions))
    })

  if (argv.security != './security') {
    app.use('/security', express.static(path.join(argv.packageDir, argv.security_type, 'client'), staticPathOptions))
  }

  if ('development' == app.get('env')) {
    app.use(errorHandler())
    argv.debug = true
  }

  log(argv)

  const index = argv.home + '.html'

  // ---- Routes ----

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
    user = securityhandler.getUser(req)
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

  app.get(/^\/([a-z0-9-]+)\.html$/, cors, async (req, res, next) => {
    const slug = req.params[0]
    log(slug)
    if (slug === 'runtests') return next()
    try {
      const { page, status } = await pagehandler.get(slug)
      if (status === 404) return res.status(404).send(page)
      page.title ||= slug.replace(/-+/g, ' ')
      page.story ||= []
      user = securityhandler.getUser(req)
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
      res.e(e)
    }
  })

  app.get('/system/factories.json', async (req, res) => {
    const factories = []
    const getFactory = plugin =>
      import(`${plugin}/factory.json`, { with: { type: 'json' } })
        .then(({ default: factory }) => factories.push(factory))
        .catch(() => {})

    await Promise.all(
      Object.keys(packageJson.dependencies)
        .filter(d => d.startsWith('wiki-plugin'))
        .map(getFactory),
    )
    res.status(200).json(factories)
  })

  // JSON page routes
  app.get(/^\/([a-z0-9-]+)\.json$/, cors, async (req, res) => {
    try {
      const { page, status } = await pagehandler.get(req.params[0])
      res.status(status || 200).send(page)
    } catch (e) {
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

  // Theme
  app.get(/^\/theme\/(\w+\.\w+)$/, cors, (req, res) => {
    res.sendFile(path.join(argv.status, 'theme', req.params[0]), { dotfiles: 'allow' }, e => {
      if (e) {
        if (req.path === '/theme/style.css') {
          res.set('Content-Type', 'text/css')
          res.send('')
        } else {
          res.sendStatus(404)
        }
      }
    })
  })

  // Favicon
  const favLoc = path.join(argv.status, 'favicon.png')
  const defaultFavLoc = path.join(argv.root, 'default-data', 'status', 'favicon.png')
  app.get('/favicon.png', cors, async (req, res) => {
    try {
      await fsp.access(favLoc)
      res.sendFile(favLoc, { dotfiles: 'allow' })
    } catch {
      res.sendFile(defaultFavLoc, { dotfiles: 'allow' })
    }
  })

  const authorized = (req, res, next) => {
    if (securityhandler.isAuthorized(req)) {
      next()
    } else {
      console.log('rejecting', req.path)
      res.sendStatus(403)
    }
  }

  app.post('/favicon.png', authorized, async (req, res) => {
    const favicon = req.body.image.replace(/^data:image\/png;base64,/, '')
    const buf = Buffer.from(favicon, 'base64')
    try {
      await fsp.mkdir(argv.status, { recursive: true })
      await fsp.writeFile(favLoc, buf)
      res.send('Favicon Saved')
    } catch (e) {
      res.e(e)
    }
  })

  app.get(/^\/remote\/([a-zA-Z0-9:.-]+\/favicon.png)$/, (req, res) => {
    res.redirect(`http://${req.params[0]}`)
  })

  // Recycler
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
            const { page, status } = await pagehandler.get('recycler/' + file)
            if (status === 404) return null
            return { slug: file, title: page.title }
          } catch (e) {
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
      const { page, status } = await pagehandler.get('recycler/' + req.params[0])
      res.status(status || 200).send(page)
    } catch (e) {
      res.e(e)
    }
  })

  app.delete(/^\/recycler\/([a-z0-9-]+)\.json$/, authorized, async (req, res) => {
    try {
      await pagehandler.delete('recycler/' + req.params[0])
      res.status(200).send('')
    } catch (err) {
      res.status(500).send(err)
    }
  })

  // Meta routes
  app.get('/system/slugs.json', cors, async (req, res) => {
    try {
      const slugs = await pagehandler.slugs()
      res.send(slugs)
    } catch (err) {
      res.status(500).send(err)
    }
  })

  app.get('/system/plugins.json', cors, (req, res) => {
    try {
      const pluginNames = Object.keys(packageJson.dependencies)
        .filter(d => d.startsWith('wiki-plugin'))
        .map(name => name.slice(12))
      res.send(pluginNames)
    } catch (e) {
      res.e(e)
    }
  })

  const sitemapLoc = path.join(argv.status, 'sitemap.json')
  app.get('/system/sitemap.json', cors, async (req, res) => {
    try {
      await fsp.access(sitemapLoc)
      res.sendFile(sitemapLoc, { dotfiles: 'allow' })
    } catch {
      if (!sitemaphandler.isWorking()) {
        sitemaphandler.createSitemap(pagehandler)
      }
      sitemaphandler.once('finished', () => {
        res.sendFile(sitemapLoc, { dotfiles: 'allow' })
      })
    }
  })

  const xmlSitemapLoc = path.join(argv.status, 'sitemap.xml')
  app.get('/sitemap.xml', cors, async (req, res) => {
    try {
      await fsp.access(sitemapLoc)
      res.sendFile(xmlSitemapLoc, { dotfiles: 'allow' })
    } catch {
      if (!sitemaphandler.isWorking()) {
        sitemaphandler.createSitemap(pagehandler)
      }
      sitemaphandler.once('finished', () => {
        res.sendFile(xmlSitemapLoc, { dotfiles: 'allow' })
      })
    }
  })

  const searchIndexLoc = path.join(argv.status, 'site-index.json')
  app.get('/system/site-index.json', cors, async (req, res) => {
    try {
      await fsp.access(searchIndexLoc)
      res.sendFile(searchIndexLoc, { dotfiles: 'allow' })
    } catch {
      if (!searchhandler.isWorking()) {
        searchhandler.createIndex(pagehandler)
      }
      searchhandler.once('indexed', () => {
        res.sendFile(searchIndexLoc, { dotfiles: 'allow' })
      })
    }
  })

  app.get('/system/export.json', cors, async (req, res) => {
    try {
      const sitemap = await pagehandler.pages()
      const pages = await Promise.all(
        sitemap.map(async stub => {
          const { page } = await pagehandler.get(stub.slug)
          return { slug: stub.slug, page }
        }),
      )
      const pageExport = pages.reduce((dict, { slug, page }) => {
        dict[slug] = page
        return dict
      }, {})
      res.json(pageExport)
    } catch (e) {
      res.e(e)
    }
  })

  const admin = (req, res, next) => {
    if (securityhandler.isAdmin(req)) {
      next()
    } else {
      console.log('rejecting', req.path)
      res.sendStatus(403)
    }
  }

  app.get('/system/version.json', admin, async (req, res) => {
    const getVersion = async name => {
      try {
        const { default: pkg } = await import(`${name}/package.json`, { with: { type: 'json' } })
        return { [name]: pkg.version }
      } catch {
        return { [name]: 'unknown' }
      }
    }

    const deps = Object.keys(packageJson.dependencies)
    const securityVersions = await Promise.all(
      deps.filter(d => d.startsWith('wiki-security')).map(getVersion),
    )
    const pluginVersions = await Promise.all(
      deps.filter(d => d.startsWith('wiki-plugin')).map(getVersion),
    )

    const versions = {
      [packageJson.name]: packageJson.version,
      ...(await getVersion('wiki-server')),
      ...(await getVersion('wiki-client')),
      security: Object.assign({}, ...securityVersions),
      plugins: Object.assign({}, ...pluginVersions),
    }
    res.json(versions)
  })

  // Proxy
  app.get('/proxy/*splat', authorized, async (req, res) => {
    const pathParts = req.originalUrl.split('/')
    const remoteHost = pathParts[2]
    pathParts.splice(0, 3)
    const remoteResource = pathParts.join('/')
    const requestURL = 'http://' + remoteHost + '/' + remoteResource
    console.log('PROXY Request: ', requestURL)
    if (
      requestURL.endsWith('.json') ||
      requestURL.endsWith('.png') ||
      requestURL.endsWith('.jpg') ||
      pathParts[0] === 'plugin'
    ) {
      try {
        const fetchRes = await fetch(requestURL, { signal: AbortSignal.timeout(2000) })
        if (fetchRes.ok) {
          res.set('content-type', fetchRes.headers.get('content-type'))
          res.set('last-modified', fetchRes.headers.get('last-modified'))
          await pipeline(fetchRes.body, res)
        } else {
          res.status(fetchRes.status).end()
        }
      } catch (err) {
        console.log('ERROR: Proxy Request ', requestURL, err)
        res.status(500).end()
      }
    } else {
      res.status(400).end()
    }
  })

  // Put (page actions)
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

      sitemaphandler.update(slug, page)
      searchhandler.update(slug, page)
    }

    try {
      if (action.fork) {
        try {
          await pagehandler.saveToRecycler(slug)
        } catch (err) {
          if (err !== 'page does not exist' && err?.message !== 'page does not exist') {
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
        const { status } = await pagehandler.get(slug)
        if (status !== 404) {
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
        const { page, status } = await pagehandler.get(slug)
        if (status === 404) return res.e(page, 404)
        await applyAction(page)
      }
    } catch (e) {
      res.e(e)
    }
  })

  app.get('/oops', (req, res) => {
    res.statusCode = 403
    res.render('oops.html', { msg: 'This is not your wiki!' })
  })

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

  // Delete
  app.delete(/^\/([a-z0-9-]+)\.json$/, authorized, async (req, res) => {
    const slug = req.params[0]
    try {
      await pagehandler.delete(slug)
      sitemaphandler.removePage(slug)
      searchhandler.removePage(slug)
      res.status(200).send('')
    } catch (err) {
      res.status(500).send(err)
    }
  })

  // Startup
  process.exitCode = argv.test ? 0 : 1

  securityhandler.retrieveOwner(e => {
    if (e) throw e
    owner = securityhandler.getOwner()
    console.log('owner: ' + owner)
    app.emit('owner-set')
  })

  app.on('running-serv', server => {
    const plugins = pluginsFactory(argv)
    plugins.startServers({ argv, app, packageJson })
    sitemaphandler.createSitemap(pagehandler)
    searchhandler.startUp(pagehandler)
  })

  return app
}
