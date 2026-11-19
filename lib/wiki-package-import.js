import path from 'path'
import url from 'url'

// Use import to load package.json from the main application's working directory
//const { default: packageJson } = await import('wiki/package.json', { with: { type: 'json' } })
const wikiPackageImport = async () => {
  let done = false
  return new Promise(resolve => {
    import('wiki/package.json', { with: { type: 'json' } })
      .then(imported => {
        done = true
        resolve(imported.default)
      })
      .catch(e => {
        return e
      })
      .then(async () => {
        if (done) return
        const packageJsonPath = path.join(process.cwd(), 'package.json')
        const packageJsonUrl = url.pathToFileURL(packageJsonPath).href
        import(packageJsonUrl, { with: { type: 'json' } })
          .then(imported => {
            resolve(imported.default)
          })
          .catch(e => console.error('problems importing package', e))
      })
  })
}

export const packageJson = await wikiPackageImport()
console.log(packageJson)
