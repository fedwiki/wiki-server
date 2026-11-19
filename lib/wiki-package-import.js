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

// in test (wiki-server) the plugins are listed as devDependencues, so we need to fallback to
// using devDEpendencies when there are no plugins in dependencies.
const dependencyPlugins = Object.keys(packageJson.dependencies).filter(depend => depend.startsWith('wiki-plugin'))

export const plugins = dependencyPlugins.length
  ? dependencyPlugins
  : Object.keys(packageJson.devDependencies).filter(depend => depend.startsWith('wiki-plugin'))

export const pluginNames = plugins.map(name => name.slice(12))
