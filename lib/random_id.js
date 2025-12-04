/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

// **random_id.coffee**
// Simple random hex generator, takes an optional number of
// chars that defaults to 16 and returns a random id.

export default (chars = 16) => [...Array(chars)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
