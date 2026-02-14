/*
 * Federated Wiki : Node Server
 *
 * Meta routes: sitemap, search index, slugs, plugins, export, version.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'

export default ({ app, pagehandler, sitemaphandler, searchhandler, packageJson, authorized, admin, cors, argv }) => {

  // ---- Slugs ----

  app.get('/system/slugs.json', cors, async (req, res) => {
    try {
      const slugs = await pagehandler.slugs()
      res.send(slugs)
    } catch (err) {
      res.status(500).send(err.message || err)
    }
  })

  // ---- Plugins ----

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

  // ---- Sitemap ----

  const sitemapLoc = path.join(argv.status, 'sitemap.json')
  const xmlSitemapLoc = path.join(argv.status, 'sitemap.xml')

  app.get('/system/sitemap.json', cors, async (req, res) => {
    try {
      await fsp.access(sitemapLoc)
      res.sendFile(sitemapLoc, { dotfiles: 'allow' })
    } catch {
      if (!sitemaphandler.isWorking()) {
        await sitemaphandler.createSitemap(pagehandler)
      } else {
        await new Promise(resolve => sitemaphandler.once('finished', resolve))
      }
      res.sendFile(sitemapLoc, { dotfiles: 'allow' })
    }
  })

  app.get('/sitemap.xml', cors, async (req, res) => {
    try {
      await fsp.access(sitemapLoc)
      res.sendFile(xmlSitemapLoc, { dotfiles: 'allow' })
    } catch {
      if (!sitemaphandler.isWorking()) {
        await sitemaphandler.createSitemap(pagehandler)
      } else {
        await new Promise(resolve => sitemaphandler.once('finished', resolve))
      }
      res.sendFile(xmlSitemapLoc, { dotfiles: 'allow' })
    }
  })

  // ---- Search index ----

  const searchIndexLoc = path.join(argv.status, 'site-index.json')

  app.get('/system/site-index.json', cors, async (req, res) => {
    try {
      await fsp.access(searchIndexLoc)
      res.sendFile(searchIndexLoc, { dotfiles: 'allow' })
    } catch {
      if (!searchhandler.isWorking()) {
        await searchhandler.createIndex(pagehandler)
      } else {
        await new Promise(resolve => searchhandler.once('indexed', resolve))
      }
      res.sendFile(searchIndexLoc, { dotfiles: 'allow' })
    }
  })

  // ---- Export ----

  app.get('/system/export.json', cors, async (req, res) => {
    try {
      const sitemap = await pagehandler.pages()
      const pages = await Promise.all(
        sitemap.map(async stub => {
          const page = await pagehandler.get(stub.slug)
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

  // ---- Version ----

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
}
