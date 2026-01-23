import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import random from '../lib/random_id.js'

describe('random', () => {
  describe('#random_id', () => {
    it('should not be the same twice', () => {
      assert.notEqual(random(), random())
    })
    it('should be 16 digits', () => {
      assert.equal(random().length, 16)
    })
  })
})
