import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'

import supertest from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Emulate __dirname in ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Dynamic import of CommonJS module
const { default: server } = await import('../index.js')

// ESM imports
import random from '../lib/random_id.js'
import defaultargs from '../lib/defaultargs.js'

const testid = random()
const argv = defaultargs({
  data: path.join('/tmp', 'sfwtests', testid),
  port: 55556,
  security_legacy: true,
  test: true,
})

describe('sitemap', () => {
  let app = {}
  let runningServer = null

  before(done => {
    app = server.default(argv)
    app.once('owner-set', () => {
      runningServer = app.listen(app.startOpts.port, app.startOpts.host, done)
    })
  })

  after(() => {
    runningServer.close()
  })

  const request = supertest('http://localhost:55556')
  fs.mkdirSync(path.join('/tmp', 'sfwtests', testid, 'pages'), { recursive: true })

  // location of the sitemap
  const sitemapLoc = path.join('/tmp', 'sfwtests', testid, 'status', 'sitemap.json')

  it('new site should have an empty sitemap', async () => {
    await request
      .get('/system/sitemap.json')
      .expect(200)
      .expect('Content-Type', /json/)
      .then(res => {
        assert.equal(res.body.length, 0)
      })
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
      // sitemap update does not happen until after the put has returned, so wait for it to finish
      .then(() => new Promise(resolve => app.sitemaphandler.once('finished', () => resolve())))
      .then(
        () => {
          const sitemap = JSON.parse(fs.readFileSync(sitemapLoc))
          assert.equal(sitemap[0].slug, 'adsf-test-page')
          assert.equal(sitemap[0].synopsis, 'this is the first paragraph')
          assert.deepEqual(sitemap[0].links, { third: 'a3' })
        },
        err => {
          throw err
        },
      )
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
      .then(() => new Promise(resolve => app.sitemaphandler.once('finished', () => resolve())))
      .then(() => {
        const sitemap = JSON.parse(fs.readFileSync(sitemapLoc))
        assert.equal(sitemap[0].slug, 'adsf-test-page')
        assert.equal(sitemap[0].synopsis, 'edited')
      })
  })

  it('deleting a page should remove it from the sitemap', async () => {
    await request
      .delete('/adsf-test-page.json')
      .send()
      .expect(200)
      .then(() => new Promise(resolve => app.sitemaphandler.once('finished', () => resolve())))
      .then(() => {
        const sitemap = JSON.parse(fs.readFileSync(sitemapLoc))
        assert.deepEqual(sitemap, [])
      })
  })
})
