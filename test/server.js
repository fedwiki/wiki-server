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
  port: 55557,
  security_legacy: true,
  test: true,
})

describe('server', () => {
  let app = {}
  let runningServer = null

  before(async () => {
    const sitemapLoc = path.join('/tmp', 'sfwtests', testid, 'status', 'sitemap.json')
    fs.mkdirSync(path.join('/tmp', 'sfwtests', testid), { recursive: true })
    fs.mkdirSync(path.join('/tmp', 'sfwtests', testid, 'status'), { recursive: true })
    fs.writeFileSync(sitemapLoc, JSON.stringify([]))

    app = await server.default(argv)

    await new Promise(resolve => {
      runningServer = app.listen(app.startOpts.port, app.startOpts.host, resolve)
    })
  })

  after(() => {
    runningServer.close()
  })

  const request = supertest('http://localhost:55557')
  const loc = path.join('/tmp', 'sfwtests', testid, 'pages', 'adsf-test-page')

  it('factories should return a list of plugin', async () => {
    const res = await request.get('/system/factories.json').expect(200).expect('Content-Type', /json/)
    assert.equal(res.body[1].name, 'Video')
    assert.equal(res.body[1].category, 'format')
  })

  it('new site should have an empty list of pages', async () => {
    const res = await request.get('/system/slugs.json').expect(200).expect('Content-Type', /json/)
    assert.deepEqual(res.body, [])
  })

  it('should create a page', async () => {
    const body = JSON.stringify({
      type: 'create',
      item: {
        title: 'Asdf Test Page',
        story: [
          { id: 'a1', type: 'paragraph', text: 'this is the first paragraph' },
          { id: 'a2', type: 'paragraph', text: 'this is the second paragraph' },
          { id: 'a3', type: 'paragraph', text: 'this is the third paragraph' },
          { id: 'a4', type: 'paragraph', text: 'this is the fourth paragraph' },
        ],
      },
      date: 1234567890123,
    })

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)
  })

  it('should move the paragraphs to the order given', async () => {
    const body = '{ "type": "move", "order": [ "a1", "a3", "a2", "a4"] }'

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)

    const page = JSON.parse(fs.readFileSync(loc, 'utf8'))
    assert.equal(page.story[1].id, 'a3')
    assert.equal(page.story[2].id, 'a2')
    assert.equal(page.journal[1].type, 'move')
  })

  it('should add a paragraph', async () => {
    const body = JSON.stringify({
      type: 'add',
      after: 'a2',
      item: { id: 'a5', type: 'paragraph', text: 'this is the NEW paragrpah' },
    })

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)

    const page = JSON.parse(fs.readFileSync(loc, 'utf8'))
    assert.equal(page.story.length, 5)
    assert.equal(page.story[3].id, 'a5')
    assert.equal(page.journal[2].type, 'add')
  })

  it('should remove a paragraph with given id', async () => {
    const body = JSON.stringify({
      type: 'remove',
      id: 'a2',
    })

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)

    const page = JSON.parse(fs.readFileSync(loc, 'utf8'))
    assert.equal(page.story.length, 4)
    assert.equal(page.story[1].id, 'a3')
    assert.notEqual(page.story[2].id, 'a2')
    assert.equal(page.story[2].id, 'a5')
    assert.equal(page.journal[3].type, 'remove')
  })

  it('should edit a paragraph in place', async () => {
    const body = JSON.stringify({
      type: 'edit',
      item: { id: 'a3', type: 'paragraph', text: 'edited' },
      id: 'a3',
    })

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)

    const page = JSON.parse(fs.readFileSync(loc, 'utf8'))
    assert.equal(page.story[1].text, 'edited')
    assert.equal(page.journal[4].type, 'edit')
  })

  it('should default to no change', async () => {
    const body = JSON.stringify({
      type: 'asdf',
    })

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(500)

    const page = JSON.parse(fs.readFileSync(loc, 'utf8'))
    assert.equal(page.story.length, 4)
    assert.equal(page.journal.length, 5)
    assert.equal(page.story[0].id, 'a1')
    assert.equal(page.story[3].text, 'this is the fourth paragraph')
    assert.equal(page.journal[4].type, 'edit')
  })

  it('should refuse to create over a page', async () => {
    const body = JSON.stringify({
      type: 'create',
      item: { title: 'Doh' },
      id: 'c1',
    })

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(409)

    const page = JSON.parse(fs.readFileSync(loc, 'utf8'))
    assert.notEqual(page.title, 'Doh')
  })

  it('site should now have one page', async () => {
    const res = await request.get('/system/slugs.json').expect(200).expect('Content-Type', /json/)
    assert.equal(res.body.length, 1)
    assert.equal(res.body[0], 'adsf-test-page')
  })

  it.skip('server should return a version', async () => {
    const res = await request.get('/system/version.json').expect(200).expect('Content-Type', /json/)
    assert.equal(res.body.wiki, '0.1')
    assert.equal(res.body['wiki-server'], '0.2')
    assert.equal(res.body['wiki-client'], '0.3')
    assert.equal(res.body.plugins['wiki-plugin-activity'], '0.4')
    assert.equal(res.body.plugins['wiki-plugin-video'], '0.5')
  })
})
