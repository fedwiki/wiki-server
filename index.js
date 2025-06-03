// **index.js**
// Simple file so that if you require this directory
// in node it instead requires ./lib/server.coffee
// with coffee-script already loaded.
import('coffeescript')
import('coffeescript/register.js')

import * as server from './lib/server.cjs'
export default server
