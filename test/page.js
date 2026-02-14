import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import path from 'node:path'
import fs from 'node:fs'

import { fileURLToPath } from 'node:url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import random from '../lib/random_id.js'
import defaultargs from '../lib/defaultargs.js'
import pageFactory from '../lib/page.js'

const testid = random()
const argv = defaultargs({
  data: path.join('/tmp', 'sfwtests', testid),
  root: path.join(__dirname, '..'),
  packageDir: path.join(__dirname, '..', 'node_modules'),
  packageFile: path.join(__dirname, 'package.json'),
  security_legacy: true,
})

const page = pageFactory(argv)

const testpage = { title: 'Asdf' }

console.log('testid', testid)

describe('page', () => {
  describe('#page.put()', () => {
    it('should save a page', async () => {
      await page.put('asdf', testpage)
    })
  })

  describe('#page.get()', () => {
    it('should get a page if it exists', async () => {
      const { page: got } = await page.get('asdf')
      assert.equal(got.title, 'Asdf')
    })

    it('should copy a page from default if nonexistant in db', async () => {
      const { page: got } = await page.get('welcome-visitors')
      assert.equal(got.title, 'Welcome Visitors')
    })

    it('should copy a page from plugins if nonexistant in db', async () => {
      const { page: got } = await page.get('recent-changes')
      assert.equal(got.title, 'Recent Changes')
    })

    it('should mark a page from plugins with the plugin name', async () => {
      const { page: got } = await page.get('recent-changes')
      assert.equal(got.plugin, 'activity')
    })

    it('should create a page if it exists nowhere', async () => {
      const { page: got, status } = await page.get(random())
      assert.equal(got, 'Page not found')
      assert.equal(status, 404)
    })

    it('should eventually write the page to disk', async () => {
      const { page: got } = await page.get('asdf')
      const ondisk = JSON.parse(
        fs.readFileSync(path.join('/tmp', 'sfwtests', testid, 'pages', 'asdf'), 'utf8'),
      )
      assert.equal(got.title, ondisk.title)
    })
  })
})
