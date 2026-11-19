import path from 'path'
import url from 'url'

// Use import to load package.json from the main application's working directory

let wikiPackage = {}
try {
  wikiPackage = await import('wiki/package.json', { with: { type: 'json' } })
} catch (e) {
  const packageJsonPath = path.join(process.cwd(), 'package.json')
  const packageJsonUrl = url.pathToFileURL(packageJsonPath).href
  try {
    wikiPackage = await import(packageJsonUrl, { with: { type: 'json' } })
  } catch (err) {
    console.error('problems importing package', err)
  }
}

export const packageJson = wikiPackage.default
