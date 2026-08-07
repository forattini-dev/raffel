import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const stableVersionPattern = /^(\d+)\.(\d+)\.(\d+)$/

function stableVersionParts(version) {
  const match = stableVersionPattern.exec(version)
  return match ? match.slice(1).map(BigInt) : undefined
}

export function highestStableVersion(versions) {
  const stableVersions = versions.filter((version) =>
    stableVersionPattern.test(version),
  )

  stableVersions.sort((left, right) => {
    const leftParts = stableVersionParts(left)
    const rightParts = stableVersionParts(right)

    for (let index = 0; index < 3; index += 1) {
      if (leftParts[index] < rightParts[index]) return -1
      if (leftParts[index] > rightParts[index]) return 1
    }

    return 0
  })

  const highest = stableVersions.at(-1)
  if (!highest) {
    throw new Error('No stable versions are published')
  }

  return highest
}

function readJson(runNpm, args) {
  return JSON.parse(runNpm(args))
}

export function reconcileLatest(packageName, runNpm, maxAttempts = 6) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const versionsValue = readJson(runNpm, [
      'view',
      packageName,
      'versions',
      '--json',
    ])
    const versions = Array.isArray(versionsValue)
      ? versionsValue
      : [versionsValue]
    const desiredLatest = highestStableVersion(versions)

    const promotionOutput = runNpm([
      'dist-tag',
      'add',
      `${packageName}@${desiredLatest}`,
      'latest',
    ])
    if (promotionOutput) process.stdout.write(`${promotionOutput.trim()}\n`)

    // Re-read both observables after the write. If another release appeared
    // during promotion, loop and converge on the new highest stable version.
    const currentVersionsValue = readJson(runNpm, [
      'view',
      packageName,
      'versions',
      '--json',
    ])
    const currentVersions = Array.isArray(currentVersionsValue)
      ? currentVersionsValue
      : [currentVersionsValue]
    const currentHighest = highestStableVersion(currentVersions)
    const currentLatest = readJson(runNpm, [
      'view',
      packageName,
      'dist-tags.latest',
      '--json',
    ])

    if (currentLatest === currentHighest) {
      return currentHighest
    }

    console.warn(
      `latest is ${currentLatest}, but the highest stable version is ${currentHighest} ` +
        `(attempt ${attempt}/${maxAttempts})`,
    )
  }

  throw new Error(`Could not reconcile ${packageName} latest dist-tag`)
}

function runNpm(args) {
  return execFileSync('npm', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
}

const entryPoint = process.argv[1]
if (entryPoint && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  const packageName = process.argv[2]
  if (!packageName) {
    console.error(
      'Usage: node scripts/promote-latest.mjs <package> [npm options]',
    )
    process.exit(1)
  }

  const npmOptions = process.argv.slice(3)
  const latest = reconcileLatest(packageName, (args) =>
    runNpm([...args, ...npmOptions]),
  )
  console.log(`Verified ${packageName}@${latest} as latest`)
}
