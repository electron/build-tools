const path = require('path')

const package = require(path.resolve(process.cwd(), 'package.json'))

if (package.version.includes('nightly')) {
  console.log('master')
} else {
  const versionMatch = /^([0-9]+)\.([0-9]+)\.[0-9]+.*$/.exec(package.version)
  if (!versionMatch) {
    console.error('Failed to determine target PR branch')
    process.exit(1)
  }
  console.log(`${versionMatch[1]}-${versionMatch[2]}-x`)
}