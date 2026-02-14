import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'

import supertest from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const server = await import('../index.js')

import random from '../lib/random_id.js'
import defaultargs from '../lib/defaultargs.js'

const testid = random()
const argv = defaultargs({
  data: path.join('/tmp', 'sfwtests', testid),
  packageDir: path.join(__dirname, '..', 'node_modules'),
  packageFile: path.join(__dirname, 'package.json'),
  port: 55556,
  security_legacy: true,
  test: true,
})

describe('sitemap', () => {
  let app = {}
  let runningServer = null

  before(async () => {
    fs.mkdirSync(path.join('/tmp', 'sfwtests', testid, 'pages'), { recursive: true })
    app = await server.default(argv)

    await new Promise(resolve => {
      runningServer = app.listen(app.startOpts.port, app.startOpts.host, resolve)
    })
  })

  after(() => {
    runningServer.close()
  })

  const request = supertest('http://localhost:55556')
  const sitemapLoc = path.join('/tmp', 'sfwtests', testid, 'status', 'sitemap.json')

  const waitForSitemap = () => new Promise(resolve => app.sitemaphandler.once('finished', resolve))

  it('new site should have an empty sitemap', async () => {
    const res = await request.get('/system/sitemap.json').expect(200).expect('Content-Type', /json/)
    assert.equal(res.body.length, 0)
  })

  it('creating a page should add it to the sitemap', async () => {
    const body = JSON.stringify({
      type: 'create',
      item: {
        title: 'Asdf Test Page',
        story: [
          { id: 'a1', type: 'paragraph', text: 'this is the first paragraph' },
          { id: 'a2', type: 'paragraph', text: 'this is the second paragraph' },
          { id: 'a3', type: 'paragraph', text: 'this is the [[third]] paragraph' },
          { id: 'a4', type: 'paragraph', text: 'this is the fourth paragraph' },
        ],
      },
      date: 1234567890123,
    })

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)

    await waitForSitemap()

    const sitemap = JSON.parse(fs.readFileSync(sitemapLoc, 'utf8'))
    assert.equal(sitemap[0].slug, 'adsf-test-page')
    assert.equal(sitemap[0].synopsis, 'this is the first paragraph')
    assert.deepEqual(sitemap[0].links, { third: 'a3' })
  })

  it('synopsis should reflect edit to first paragraph', async () => {
    const body = JSON.stringify({
      type: 'edit',
      item: { id: 'a1', type: 'paragraph', text: 'edited' },
      id: 'a1',
    })

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)

    await waitForSitemap()

    const sitemap = JSON.parse(fs.readFileSync(sitemapLoc, 'utf8'))
    assert.equal(sitemap[0].slug, 'adsf-test-page')
    assert.equal(sitemap[0].synopsis, 'edited')
  })

  it('deleting a page should remove it from the sitemap', async () => {
    await request.delete('/adsf-test-page.json').send().expect(200)

    await waitForSitemap()

    const sitemap = JSON.parse(fs.readFileSync(sitemapLoc, 'utf8'))
    assert.deepEqual(sitemap, [])
  })
})
