###
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-node-server/blob/master/LICENSE.txt
###

# **random_id.coffee**
# Simple random hex generator, takes an optional number of
# chars that defaults to 16 and returns a random id.

random_id = (chars = 16) ->
  [0...chars].map( ->
    Math.floor(Math.random() * 16).toString(16)
  ).join('')

module.exports = random_id.random_id = random_id
