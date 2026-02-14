/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

// **defaultargs.coffee** when called on the argv object this
// module will create reasonable defaults for options not supplied,
// based on what information is provided.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const getUserHome = () => {
  return process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE
}

export default argv => {
  argv = argv || {}
  argv.root ||= __dirname
  // the directory that contains all the packages that makeup the wiki
  argv.packageDir ||= path.join(argv.root, '..')
  // In a standard npm install, the wiki package.json is at packageDir/wiki/package.json.
  // In development, fall back to the package.json in the current working directory.
  if (!argv.packageFile) {
    const installed = path.join(argv.packageDir, 'wiki', 'package.json')
    try {
      fs.accessSync(installed, fs.constants.F_OK)
      argv.packageFile = installed
    } catch {
      argv.packageFile = path.join(process.cwd(), 'package.json')
    }
  }
  argv.port ||= 3000
  argv.home ||= 'welcome-visitors'
  argv.data ||= path.join(getUserHome(), '.wiki') // see also cli
  argv.client ||= path.join(argv.packageDir, 'wiki-client', 'client')
  argv.db ||= path.join(argv.data, 'pages')
  argv.status ||= path.join(argv.data, 'status')
  argv.assets ||= path.join(argv.data, 'assets')
  argv.recycler ||= path.join(argv.data, 'recycle')
  argv.commons ||= path.join(argv.data, 'commons')
  argv.url ||= `http://localhost${argv.port === 80 ? '' : ':' + argv.port}`
  argv.id ||= path.join(argv.status, 'owner.json')
  argv.uploadLimit ||= '5mb'
  argv.cookieSecret ||= randomBytes(64).toString('hex')
  argv.secure_cookie ||= false
  argv.session_duration ||= 7
  argv.neighbors ||= ''
  argv.debug ||= false
  argv.test ||= false

  if (typeof argv.database === 'string') {
    argv.database = JSON.parse(argv.database)
  }
  argv.database ||= {}
  argv.database.type ||= './page.js'
  if (argv.database.type.charAt(0) === '.') {
    if (argv.database.type != './page.js') {
      console.log('\n\nWARNING: This storage option is depeciated.')
      console.log('    See ReadMe for details of the changes required.\n\n')
    }
  } else {
    argv.database.type = 'wiki-storage-' + argv.database.type
  }

  argv.security_type ||= './security.js'
  if (argv.security_type === './security.js') {
    console.log('\n\nINFORMATION: Using default security module.')
  } else {
    argv.security_type = 'wiki-security-' + argv.security_type
  }
  argv.security_legacy ||= false

  // resolve all relative paths
  argv.root = path.resolve(argv.root)
  argv.packageDir = path.resolve(argv.packageDir)
  argv.packageFile = path.resolve(argv.packageFile)
  argv.data = path.resolve(argv.data)
  argv.client = path.resolve(argv.client)
  argv.db = path.resolve(argv.db)
  argv.status = path.resolve(argv.status)
  argv.assets = path.resolve(argv.assets)
  argv.recycler = path.resolve(argv.recycler)
  argv.commons = path.resolve(argv.commons)
  argv.id = path.resolve(argv.id)

  if (/node_modules/.test(argv.data)) {
    console.log('\n\nWARNING : The dafault data path is not a safe place.')
    console.log('       : by using ', argv.data, ' your pages will be lost when packages are updated.')
    console.log('       : You are strongly advised to use an alternative directory.')
    console.log('       : See the wiki package ReadMe for how to do this.\n\n')
  }
  return argv
}
