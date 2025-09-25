import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import defaultargs from '../lib/defaultargs.js'

describe('defaultargs', () => {
  describe('#defaultargs()', () => {
    it('should not write over give args', () => {
      assert.equal(defaultargs({ port: 1234 }).port, 1234)
    })
    it('should write non give args', () => {
      assert.equal(defaultargs().port, 3000)
    })
    it('should modify dependant args', () => {
      assert.equal(defaultargs({ data: '/tmp/asdf/' }).db, '/tmp/asdf/pages')
    })
  })
})
