/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

// **server.coffee** is the main guts of the express version
// of (Smallest Federated Wiki)[https://github.com/WardCunningham/Smallest-Federated-Wiki].
// The CLI and Farm are just front ends
// for setting arguments, and spawning servers.  In a complex system
// you would probably want to replace the CLI/Farm with your own code,
// and use server.coffee directly.
//
// #### Dependencies ####
// anything not in the standard library is included in the repo, or
// can be installed with an:
//     npm install

// Standard lib
import fs from 'fs'
import path from 'path'
import url from 'url'
import { pipeline } from 'node:stream/promises'

// From npm
import express from 'express'
import hbs from 'express-hbs'
import f from 'flates'

import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'

const window = new JSDOM('').window
const DOMPurify = createDOMPurify(window)

// Using native fetch API (available in Node.js 18+)

// Express 4 middleware
import logger from 'morgan'
import cookieParser from 'cookie-parser'
import methodOverride from 'method-override'
// session = require('express-session') // This one was commented out — uncomment if used
import sessions from 'client-sessions'
import bodyParser from 'body-parser'
import errorHandler from 'errorhandler'

// Local files
// Make sure these files are ESM modules or compatible
// If they are CommonJS, you will need to dynamically import them (see below)
import defargs from './defaultargs.js'
import resolveClient from 'wiki-client/lib/resolve.js'
import pluginsFactory from './plugins.js'
import sitemapFactory from './sitemap.js'
import searchFactory from './search.js'
import { warn } from 'node:console'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// Use import to load package.json from the main application's working directory
//const { default: packageJson } = await import('wiki/package.json', { with: { type: 'json' } })
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

const render = page => {
  return (
    f.div({ class: 'twins' }, f.p('')) +
    '\n' +
    f.div(
      { class: 'header' },
      f.h1(
        f.a({ href: '/', style: 'text-decoration: none' }, f.img({ height: '32px', src: '/favicon.png' })) +
          ' ' +
          page.title,
      ),
    ) +
    '\n' +
    f.div(
      { class: 'story' },
      page.story
        .map(story => {
          if (!story) return ''
          if (story.type === 'paragraph') {
            f.div({ class: 'item paragraph' }, f.p(resolveClient.resolveLinks(story.text)))
          } else if (story.type === 'image') {
            f.div(
              { class: 'item image' },
              f.img({ class: 'thumbnail', src: story.url }),
              f.p(resolveClient.resolveLinks(story.text || story.caption || 'uploaded image')),
            )
          } else if (story.type === 'html') {
            f.div({ class: 'item html' }, f.p(resolveClient.resolveLinks(story.text || '', DOMPurify.sanitize)))
          } else f.div({ class: 'item' }, f.p(resolveClient.resolveLinks(story.text || '')))
        })
        .join('\n'),
    )
  )
}
// Set export objects for node and coffee to a function that generates a sfw server.
export default async argv => {
  // Create the main application object, app.
  const app = express()

  // remove x-powered-by header
  app.disable('x-powered-by')

  // defaultargs.coffee exports a function that takes the argv object
  // that is passed in and then does its
  // best to supply sane defaults for any arguments that are missing.
  argv = defargs(argv)

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

  // Dynamically import database adapter (since the module name is dynamic)
  const dbModule = await import(argv.database.type)
  app.pagehandler = pagehandler = dbModule.default(argv)

  // Initialize sitemap handler
  app.sitemaphandler = sitemaphandler = sitemapFactory(argv)

  // Initialize search handler
  app.searchhandler = searchhandler = searchFactory(argv)

  // Dynamically import security adapter (also dynamic)
  console.log('security_type', argv.security_type)
  const securityModule = await import(argv.security_type)
  app.securityhandler = securityhandler = securityModule.default(log, loga, argv)

  // If the site is owned, owner will contain the name of the owner
  let owner = ''

  // If the user is logged in, user will contain their identity
  let user = ''

  // Called from authentication when the site is claimed,
  // to update the name of the owner held here.
  const updateOwner = id => {
    owner = id
  }

  // #### Middleware ####
  //
  // Allow json to be got cross origin.
  const cors = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.get('origin') || '*')
    next()
  }

  const remoteGet = (remote, slug, cb) => {
    // assume http, as we know no better at this point and we need to specify a protocol.
    const remoteURL = new URL(`http://${remote}/${slug}.json`).toString()
    // set a two second timeout
    fetch(remoteURL, { signal: AbortSignal.timeout(2000) })
      .then(res => {
        if (res.ok) {
          return res
        }
        throw new Error(res.statusText)
      })
      .then(res => {
        return res.json()
      })
      .then(json => {
        cb(null, json, 200)
      })
      .catch(err => {
        console.error('Unable to fetch remote resource', remote, slug, err)
        cb(err, 'Page not found', 404)
      })
  }

  // #### Express configuration ####
  // Set up all the standard express server options,
  // including hbs to use handlebars/mustache templates
  // saved with a .html extension, and no layout.

  //
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

  // return deterministically colored strings
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

  // use logger, at least in development, probably needs a param to configure (or turn off).
  // use stream to direct to somewhere other than stdout.
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
  // use secureProxy as TLS is terminated in outside the node process
  let cookieName
  if (argv.secure_cookie) {
    cookieName = 'wikiTlsSession'
    cookieValue['secureProxy'] = true
  } else {
    cookieName = 'wikiSession'
  }
  app.use(
    sessions({
      cookieName: cookieName,
      requestKey: 'session',
      secret: argv.cookieSecret,
      // make the session session_duration days long
      duration: argv.session_duration * 24 * 60 * 60 * 1000,
      // add 12 hours to session if less than 12 hours to expiry
      activeDuration: 24 * 60 * 60 * 1000,
      cookie: cookieValue,
    }),
  )

  app.use(ourErrorHandler)

  // Add static route to the client
  app.use(express.static(argv.client, staticPathOptions))

  // ##### Define security routes #####
  securityhandler.defineRoutes(app, cors, updateOwner)

  // Add static route to assets
  app.use('/assets', cors, express.static(argv.assets))

  // Add static routes to the plugins client.
  Object.keys(packageJson.dependencies)
    .filter(depend => depend.startsWith('wiki-plugin'))
    .forEach(plugin => {
      const clientPath = path.join(path.dirname(require.resolve(`${plugin}/package`)), 'client')
      const pluginPath = '/plugins/' + plugin.slice(12)
      app.use(pluginPath, cors, express.static(clientPath, staticPathOptions))
    })

  // Add static routes to the security client.
  if (argv.security != './security') {
    app.use('/security', express.static(path.join(argv.packageDir, argv.security_type, 'client'), staticPathOptions))
  }

  // ##### Set up standard environments. #####
  // In dev mode turn on console.log debugging as well as showing the stack on err.
  if ('development' == app.get('env')) {
    app.use(errorHandler())
    argv.debug = true
  }

  // Show all of the options a server is using.
  log(argv)

  // #### Routes ####
  // Routes currently make up the bulk of the Express port of
  // Smallest Federated Wiki. Most routes use literal names,
  // or regexes to match, and then access req.params directly.

  // ##### Redirects #####
  // Common redirects that may get used throughout the routes.
  const index = argv.home + '.html'
  const oops = '/oops'

  // ##### Get routes #####
  // Routes have mostly been kept together by http verb, with the exception
  // of the openID related routes which are at the end together.

  // Main route for initial contact.  Allows us to
  // link into a specific set of pages, local and remote.
  // Can also be handled by the client, but it also sets up
  // the login status, and related footer html, which the client
  // relies on to know if it is logged in or not.
  app.get(/^((\/[a-zA-Z0-9:.-]+\/[a-z0-9-]+(_rev\d+)?)+)\/?$/, cors, (req, res, next) => {
    const urlPages = req.params[0]
      .split('/')
      .filter((_, index) => index % 2 === 0)
      .slice(1)
    const urlLocs = req.params[0]
      .split('/')
      .slice(1)
      .filter((_, index) => index % 2 === 0)
    if (['plugin', 'auth'].indexOf(urlLocs[0]) > -1) {
      return next()
    }
    const title = urlPages.slice().pop().replace(/-+/g, ' ')
    user = securityhandler.getUser(req)
    const info = {
      title,
      pages: [],
      authenticated: user ? true : false,
      user: user,
      seedNeighbors: argv.neighbors,
      owned: owner ? true : false,
      isOwner: securityhandler.isAuthorized(req) ? true : false,
      ownedBy: owner ? owner : '',
    }
    for (const [idx, page] of urlPages.entries()) {
      let pageDiv
      if (urlLocs[idx] === 'view') {
        pageDiv = { page }
      } else {
        pageDiv = { page, origin: `data-site=${urlLocs[idx]}` }
      }
      info.pages.push(pageDiv)
    }
    res.render('static.html', info)
  })

  app.get(/^\/([a-z0-9-]+)\.html$/, cors, (req, res, next) => {
    const slug = req.params[0]
    log(slug)
    if (slug === 'runtests') return next()
    pagehandler.get(slug, (e, page, status) => {
      if (e) {
        return res.e(e)
      }
      if (status === 404) {
        return res.status(status).send(page)
      }
      page.title ||= slug.replace(/-+/g, ' ')
      page.story ||= []
      user = securityhandler.getUser(req)

      const info = {
        title: page.title,
        pages: [
          {
            page: slug,
            generated: 'data-server-generated=true',
            story: render(page),
          },
        ],
        authenticated: user ? true : false,
        user: user,
        seedNeighbors: argv.neighbors,
        owned: owner ? true : false,
        isOwner: securityhandler.isAuthorized(req) ? true : false,
        ownedBy: owner ? owner : '',
      }
      res.render('static.html', info)
    })
  })

  app.get('/system/factories.json', (req, res) => {
    res.status(200)
    res.header('Content-Type', 'application/json')

    const factories = []

    const getPackageFactory = plugin => {
      return new Promise(resolve => {
        import(`${plugin}/factory.json`, { with: { type: 'json' } })
          .then(({ default: factory }) => {
            resolve(factories.push(factory))
          })
          .catch(() => {
            resolve()
          })
      })
    }

    // in test (wiki-server) the plugins are listed as devDependencues, so we need to fallback to
    // using devDEpendencies when there are no plugins in dependencies.
    const dependencyPlugins = Object.keys(packageJson.dependencies).filter(depend => depend.startsWith('wiki-plugin'))
    const plugins = dependencyPlugins.length
      ? dependencyPlugins
      : Object.keys(packageJson.devDependencies).filter(depend => depend.startsWith('wiki-plugin'))

    Promise.all(
      plugins.map(plugin => {
        return getPackageFactory(plugin)
      }),
    ).then(() => res.end(JSON.stringify(factories)))
  })

  // ###### Json Routes ######
  // Handle fetching local and remote json pages.
  // Local pages are handled by the pagehandler module.
  app.get(/^\/([a-z0-9-]+)\.json$/, cors, (req, res) => {
    const file = req.params[0]
    pagehandler.get(file, (e, page, status) => {
      if (e) {
        return res.e(e)
      }
      res.status(status || 200).send(page)
    })
  })

  // Remote pages use the http client to retrieve the page
  // and sends it to the client.  TODO: consider caching remote pages locally.
  app.get(/^\/remote\/([a-zA-Z0-9:.-]+)\/([a-z0-9-]+)\.json$/, (req, res) => {
    remoteGet(req.params[0], req.params[1], (e, page, status) => {
      if (e) {
        log('remoteGet error:', e)
        return res.e(e)
      }
      res.status(status || 200).send(page)
    })
  })

  // ###### Theme Routes ######
  // If themes doesn't exist send 404 and let the client
  // deal with it.
  app.get(/^\/theme\/(\w+\.\w+)$/, cors, (req, res) => {
    res.sendFile(path.join(argv.status, 'theme', req.params[0]), { dotfiles: 'allow' }, e => {
      if (e) {
        // swallow the error if the theme does not exist...
        if (req.path === '/theme/style.css') {
          res.set('Content-Type', 'text/css')
          res.send('')
        } else {
          res.sendStatus(404)
        }
      }
    })
  })

  // ###### Favicon Routes ######
  // If favLoc doesn't exist send the default favicon.
  const favLoc = path.join(argv.status, 'favicon.png')
  const defaultFavLoc = path.join(argv.root, 'default-data', 'status', 'favicon.png')
  app.get('/favicon.png', cors, (req, res) => {
    fs.access(favLoc, fs.constants.F_OK, err => {
      if (!err) {
        res.sendFile(favLoc, { dotfiles: 'allow' })
      } else {
        res.sendFile(defaultFavLoc, { dotfiles: 'allow' })
      }
    })
  })

  const authorized = (req, res, next) => {
    if (securityhandler.isAuthorized(req)) {
      next()
    } else {
      console.log('rejecting', req.path)
      res.sendStatus(403)
    }
  }

  // Accept favicon image posted to the server, and if it does not already exist
  // save it.
  app.post('/favicon.png', authorized, (req, res) => {
    const favicon = req.body.image.replace(/^data:image\/png;base64,/, '')
    const buf = Buffer.from(favicon, 'base64')
    fs.access(argv.status, fs.constants.F_OK, err => {
      if (!err) {
        fs.writeFile(favLoc, buf, e => {
          if (e) {
            return res.e(e)
          }
          res.send('Favicon Saved')
        })
      } else {
        fs.mkdir(argv.status, { recursive: true }, () => {
          fs.writeFile(favLoc, buf, e => {
            if (e) {
              return res.e(e)
            }
            res.send('Favicon Saved')
          })
        })
      }
    })
  })

  // Redirect remote favicons to the server they are needed from.
  app.get(/^\/remote\/([a-zA-Z0-9:.-]+\/favicon.png)$/, (req, res) => {
    const remotefav = `http://${req.params[0]}`
    res.redirect(remotefav)
  })

  // ###### Recycler Routes ######
  // These routes are only available to the site's owner

  // Give the recycler a standard flag - use the Taiwan symbol as the use of
  // negative space outward pointing arrows nicely indicates that items can be removed
  const recyclerFavLoc = path.join(argv.root, 'default-data', 'status', 'recycler.png')
  app.get('/recycler/favicon.png', authorized, (req, res) => {
    res.sendFile(recyclerFavLoc, { dotfiles: 'allow' })
  })

  // Send an array of pages currently in the recycler via json
  app.get('/recycler/system/slugs.json', authorized, (req, res) => {
    fs.readdir(argv.recycler, (e, files) => {
      if (e) {
        return res.e(e)
      }
      const doRecyclermap = async file => {
        return new Promise(resolve => {
          const recycleFile = 'recycler/' + file
          pagehandler.get(recycleFile, (e, page, status) => {
            if (e || status === 404) {
              console.log('Problem building recycler map:', file, 'e: ', e)
              // this will leave an undefined/empty item in the array, which we will filter out later
              return resolve(null)
            }
            resolve({
              slug: file,
              title: page.title,
            })
          })
        })
      }

      Promise.all(files.map(doRecyclermap))
        .then(recyclermap => {
          recyclermap = recyclermap.filter(el => !!el)
          res.send(recyclermap)
        })
        .catch(error => {
          res.e(error)
        })
    })
  })

  // Fetching page from the recycler
  /////^/([a-z0-9-]+)\.json$///
  app.get(/^\/recycler\/([a-z0-9-]+)\.json$/, authorized, (req, res) => {
    const file = 'recycler/' + req.params[0]
    pagehandler.get(file, (e, page, status) => {
      if (e) {
        return res.e(e)
      }
      res.status(status || 200).send(page)
    })
  })

  // Delete page from the recycler
  app.delete(/^\/recycler\/([a-z0-9-]+)\.json$/, authorized, (req, res) => {
    const file = 'recycler/' + req.params[0]
    pagehandler.delete(file, err => {
      if (err) {
        res.status(500).send(err)
      }
      res.status(200).send('')
    })
  })

  // ###### Meta Routes ######
  // Send an array of pages in the database via json
  app.get('/system/slugs.json', cors, (req, res) => {
    pagehandler.slugs((err, files) => {
      if (err) {
        res.status(500).send(err)
      }
      res.send(files)
    })
  })

  // Returns a list of installed plugins. (does this get called anymore!)
  app.get('/system/plugins.json', cors, (req, res) => {
    try {
      const pluginNames = Object.keys(require.main.require('./package').dependencies)
        .filter(depend => depend.startsWith('wiki-plugin'))
        .map(name => name.slice(12))
      res.send(pluginNames)
    } catch (e) {
      return res.e(e)
    }
    // Object.keys(packageJson.dependencies)
    //   .filter(depend => depend.startsWith('wiki-plugin'))
    //   .map(name => name.slice(12))
    //   .then(names => res.send(names))
  })
  //{
  const sitemapLoc = path.join(argv.status, 'sitemap.json')
  app.get('/system/sitemap.json', cors, (req, res) => {
    fs.access(sitemapLoc, fs.constants.F_OK, err => {
      if (!err) {
        res.sendFile(sitemapLoc, { dotfiles: 'allow' })
      } else {
        // only createSitemap if we are not already creating one
        if (!sitemaphandler.isWorking()) {
          sitemaphandler.createSitemap(pagehandler)
        }
        // wait for the sitemap file to be written, before sending
        sitemaphandler.once('finished', () => {
          res.sendFile(sitemapLoc, { dotfiles: 'allow' })
        })
      }
    })
  })

  const xmlSitemapLoc = path.join(argv.status, 'sitemap.xml')
  app.get('/sitemap.xml', cors, (req, res) => {
    fs.access(sitemapLoc, fs.constants.F_OK, err => {
      if (!err) {
        res.sendFile(xmlSitemapLoc, { dotfiles: 'allow' })
      } else {
        if (!sitemaphandler.isWorking()) {
          sitemaphandler.createSitemap(pagehandler)
        }
        sitemaphandler.once('finished', () => {
          res.sendFile(xmlSitemapLoc, { dotfiles: 'allow' })
        })
      }
    })
  })

  const searchIndexLoc = path.join(argv.status, 'site-index.json')
  app.get('/system/site-index.json', cors, (req, res) => {
    fs.access(searchIndexLoc, fs.constants.F_OK, err => {
      if (!err) {
        res.sendFile(searchIndexLoc, { dotfiles: 'allow' })
      } else {
        // only create index if we are not already creating one
        if (!searchhandler.isWorking()) {
          searchhandler.createIndex(pagehandler)
        }
        searchhandler.once('indexed', () => {
          res.sendFile(searchIndexLoc, { dotfiles: 'allow' })
        })
      }
    })
  })

  app.get('/system/export.json', cors, (req, res) => {
    pagehandler.pages((e, sitemap) => {
      if (e) {
        return res.e(e)
      }
      const pagePromises = sitemap.map(stub => {
        return new Promise((resolve, reject) => {
          pagehandler.get(stub.slug, (error, page) => {
            if (error) {
              return reject(error)
            }
            resolve({ slug: stub.slug, page })
          })
        })
      })

      Promise.all(pagePromises)
        .then(pages => {
          const pageExport = pages.reduce((dict, combined) => {
            dict[combined.slug] = combined.page
            return dict
          }, {})
          // TODO: this fails for a very large site
          res.json(pageExport)
        })
        .catch(error => {
          res.e(error)
        })
    })
  })

  const admin = (req, res, next) => {
    if (securityhandler.isAdmin(req)) {
      next()
    } else {
      console.log('rejecting', req.path)
      res.sendStatus(403)
    }
  }

  app.get('/system/version.json', admin, (req, res) => {
    const getPackageVersion = packageName => {
      return new Promise(resolve => {
        try {
          // Use import to load package.json from the main application's working directory
          import(`${packageName}/package.json`, { with: { type: 'json' } }).then(({ default: packageJson }) => {
            resolve({ [packageName]: packageJson.version })
          })
        } catch (error) {
          console.error(`Error reading package for ${packageName}:`, error)
          resolve({ [packageName]: 'unknown' })
        }
      })
    }

    const versions = {}

    const security = () => {
      return new Promise(resolve => {
        Promise.all(
          Object.keys(packageJson.dependencies)
            .filter(depend => depend.startsWith('wiki-security'))
            .map(key => {
              return getPackageVersion(key)
            }),
        ).then(values => {
          resolve({ security: values.reduce((acc, cV) => Object.assign(acc, cV), {}) })
        })
      })
    }

    const plugins = () => {
      return new Promise(resolve => {
        Promise.all(
          Object.keys(packageJson.dependencies)
            .filter(depend => depend.startsWith('wiki-plugin'))
            .map(key => {
              return getPackageVersion(key)
            }),
        ).then(values => {
          resolve({ plugins: values.reduce((acc, cV) => Object.assign(acc, cV), {}) })
        })
      })
    }

    Promise.all([getPackageVersion('wiki-server'), getPackageVersion('wiki-client'), security(), plugins()]).then(v => {
      Object.assign(versions, { [packageJson.name]: packageJson.version }, ...v)
      res.json(versions)
    })
  })

  // ##### Proxy routes #####

  app.get('/proxy/*splat', authorized, (req, res) => {
    const pathParts = req.originalUrl.split('/')
    const remoteHost = pathParts[2]
    pathParts.splice(0, 3)
    const remoteResource = pathParts.join('/')
    // this will fail if remote is TLS only!
    const requestURL = 'http://' + remoteHost + '/' + remoteResource
    console.log('PROXY Request: ', requestURL)
    if (
      requestURL.endsWith('.json') ||
      requestURL.endsWith('.png') ||
      requestURL.endsWith('.jpg') ||
      pathParts[0] === 'plugin'
    ) {
      fetch(requestURL, { signal: AbortSignal.timeout(2000) })
        .then(async fetchRes => {
          if (fetchRes.ok) {
            res.set('content-type', fetchRes.headers.get('content-type'))
            res.set('last-modified', fetchRes.headers.get('last-modified'))
            await pipeline(fetchRes.body, res)
          } else {
            res.status(fetchRes.status).end()
          }
        })
        .catch(err => {
          console.log('ERROR: Proxy Request ', requestURL, err)
          res.status(500).end()
        })
    } else {
      res.status(400).end()
    }
  })

  // ##### Put routes #####

  app.put(/^\/page\/([a-z0-9-]+)\/action$/i, authorized, (req, res) => {
    const action = JSON.parse(req.body.action)
    // Handle all of the possible actions to be taken on a page,
    const actionCB = (e, page, status) => {
      //if e then return res.e e
      if (status === 404) {
        // res.status(status).send(page)
        return res.e(page, status)
      }
      // Using Coffee-Scripts implicit returns we assign page.story to the
      // result of a list comprehension by way of a switch expression.
      try {
        page.story = (() => {
          switch (action.type) {
            case 'move':
              return action.order.map(id => {
                const match = page.story.filter(para => id === para.id)[0]
                if (!match) throw 'Ignoring move. Try reload.'
                return match
              })
            case 'add': {
              const idx = page.story.map(para => para.id).indexOf(action.after) + 1
              page.story.splice(idx, 0, action.item)
              return page.story
            }

            case 'remove':
              return page.story.filter(para => para?.id !== action.id)

            case 'edit':
              return page.story.map(para => {
                if (para.id === action.id) {
                  return action.item
                } else {
                  return para
                }
              })

            case 'create':
            case 'fork':
              return page.story || []

            default:
              log('Unfamiliar action:', action)
              //page.story
              throw 'Unfamiliar action ignored'
          }
        })()
      } catch (e) {
        return res.e(e)
      }
      // Add a blank journal if it does not exist.
      // And add what happened to the journal.
      if (!page.journal) {
        page.journal = []
      }
      if (action.fork) {
        page.journal.push({ type: 'fork', site: action.fork, date: action.date - 1 })
        delete action.fork
      }
      page.journal.push(action)
      pagehandler.put(req.params[0], page, e => {
        if (e) return res.e(e)
        res.send('ok')
        // log 'saved'
      })
      // update sitemap
      sitemaphandler.update(req.params[0], page)

      // update site index
      searchhandler.update(req.params[0], page)
    }
    // log action

    // If the action is a fork, get the page from the remote server,
    // otherwise ask pagehandler for it.
    if (action.fork) {
      pagehandler.saveToRecycler(req.params[0], err => {
        if (err && err !== 'page does not exist') {
          console.log(`Error saving ${req.params[0]} before fork: ${err}`)
        }
        if (action.forkPage) {
          const forkPageCopy = JSON.parse(JSON.stringify(action.forkPage))
          delete action.forkPage
          actionCB(null, forkPageCopy)
        } else {
          // Legacy path, new clients will provide forkPage on implicit forks.
          remoteGet(action.fork, req.params[0], actionCB)
        }
      })
    } else if (action.type === 'create') {
      // Prevent attempt to write circular structure
      const itemCopy = JSON.parse(JSON.stringify(action.item))
      pagehandler.get(req.params[0], (e, page, status) => {
        if (e) return actionCB(e)
        if (status !== 404) {
          res.status(409).send('Page already exists.')
        } else {
          actionCB(null, itemCopy)
        }
      })
    } else if (action.type === 'fork') {
      pagehandler.saveToRecycler(req.params[0], err => {
        if (err) console.log(`Error saving ${req.params[0]} before fork: ${err}`)
        if (action.forkPage) {
          // push
          const forkPageCopy = JSON.parse(JSON.stringify(action.forkPage))
          delete action.forkPage
          actionCB(null, forkPageCopy)
        } else {
          // pull
          remoteGet(action.site, req.params[0], actionCB)
        }
      })
    } else {
      pagehandler.get(req.params[0], actionCB)
    }
  })

  // Return the oops page when login fails.
  app.get('/oops', (req, res) => {
    res.statusCode = 403
    res.render('oops.html', { msg: 'This is not your wiki!' })
  })

  // Traditional request to / redirects to index :)
  app.get('/', cors, (req, res) => {
    const home = path.join(argv.assets, 'home', 'index.html')
    fs.stat(home, (err, stats) => {
      if (err || !stats.isFile()) {
        res.redirect(index)
      } else {
        res.redirect('/assets/home/index.html')
      }
    })
  })

  // ##### Delete Routes #####

  app.delete(/^\/([a-z0-9-]+)\.json$/, authorized, (req, res) => {
    const pageFile = req.params[0]
    // we need the original page text to remove it from the index, so get the original text before deleting it
    pagehandler.get(pageFile, (e, page, status) => {
      const title = page.title
      pagehandler.delete(pageFile, err => {
        if (err) {
          res.status(500).send(err)
        } else {
          sitemaphandler.removePage(pageFile)
          res.status(200).send('')
          // update site index
          searchhandler.removePage(req.params[0])
        }
      })
    })
  })

  // #### Start the server ####
  //
  // set a default process exitCode, so we can diferentiate between exiting as part of a reload,
  // and an exit after an uncaught error.
  // except when test is set, so the tests don't report a fail when closing the server process.
  process.exitCode = argv.test ? 0 : 1

  // Wait to make sure owner is known before listening.
  securityhandler.retrieveOwner(e => {
    // Throw if you can't find the initial owner
    if (e) throw e
    owner = securityhandler.getOwner()
    console.log('owner: ' + owner)
    app.emit('owner-set')
  })

  app.on('running-serv', server => {
    // ### Plugins ###
    // Should replace most WebSocketServers below.
    const plugins = pluginsFactory(argv)
    plugins.startServers({ argv, app, packageJson })
    // ### Sitemap ###
    // create sitemap at start-up
    sitemaphandler.createSitemap(pagehandler)
    // create site index at start-up
    searchhandler.startUp(pagehandler)
  })

  // Return app when called, so that it can be watched for events and shutdown with .close() externally.
  return app
}
