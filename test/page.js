const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const path = require('node:path')
const random = require('../lib/random_id')
const testid = random()
const argv = require('../lib/defaultargs')({
  data: path.join('/tmp', 'sfwtests', testid),
  root: path.join(__dirname, '..'),
  packageDir: path.join(__dirname, '..', 'node_modules'),
  security_legacy: true,
})
const page = require('../lib/page')(argv)
const fs = require('node:fs')

const testpage = { title: 'Asdf' }

console.log('testid', testid)

describe('page', () => {
  describe('#page.put()', () => {
    it('should save a page', async () => {
      return new Promise(resolve => {
        page.put('asdf', testpage, e => {
          if (e) throw e
          resolve()
        })
      })
    })
  })
  describe('#page.get()', () => {
    it('should get a page if it exists', async () => {
      return new Promise(resolve => {
        page.get('asdf', (e, got) => {
          if (e) throw e
          assert.equal(got.title, 'Asdf')
          resolve()
        })
      })
    })
    it('should copy a page from default if nonexistant in db', async () => {
      return new Promise(resolve => {
        page.get('welcome-visitors', (e, got) => {
          if (e) throw e
          assert.equal(got.title, 'Welcome Visitors')
          resolve()
        })
      })
    })
    // note: here we assume the wiki-plugin-activity repo has been cloned into an adjacent directory
    it('should copy a page from plugins if nonexistant in db', async () => {
      return new Promise(resolve => {
        page.get('recent-changes', (e, got) => {
          if (e) throw e
          assert.equal(got.title, 'Recent Changes')
          resolve()
        })
      })
    })
    // note: here we assume the wiki-plugin-activity repo has been cloned into an adjacent directory
    it('should mark a page from plugins with the plugin name', async () => {
      return new Promise(resolve => {
        page.get('recent-changes', (e, got) => {
          if (e) throw e
          assert.equal(got.plugin, 'activity')
          resolve()
        })
      })
    })
    it('should create a page if it exists nowhere', async () => {
      return new Promise(resolve => {
        page.get(random(), (e, got) => {
          if (e) throw e
          assert.equal(got, 'Page not found')
          resolve()
        })
      })
    })
    it('should eventually write the page to disk', async () => {
      return new Promise(resolve => {
        page.get('asdf', (e, got) => {
          if (e) throw e
          const page = JSON.parse(fs.readFileSync(path.join(path.sep, 'tmp', 'sfwtests', testid, 'pages', 'asdf')))
          assert.equal(got.title, page.title)
          resolve()
        })
      })
    })
  })
})
