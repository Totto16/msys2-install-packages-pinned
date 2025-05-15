"strict"

const assert = require("node:assert/strict")
const core = require("@actions/core")
const exec = require("@actions/exec")
const fs = require("node:fs")
const HTMLParser = require("node-html-parser")
const http = require("@actions/http-client")
const io = require("@actions/io")
const path = require("node:path")

/**
 * @typedef {"mingw32" | "mingw64" | "ucrt64" | "clang64" | "clangarm64"} MSystem
 **/

/**
 * @typedef {object} Version
 * @property {number} major
 * @property {number} minor
 * @property {number} patch
 * @property {number} rev
 */

/**
 * @typedef {object} PartialVersion
 * @property {number|null} [major]
 * @property {number|null} [minor]
 * @property {number|null} [patch]
 * @property {number|null} [rev]
 */

/**
 * @typedef {object} RequestedVersionSameAsTheRest
 * @property {"requested"} type
 * @property {"same_as_rest"} classification
 */

/**
 * @typedef {RequestedVersionSameAsTheRest} RequestedVersion
 */

/**
 * @typedef {object} Package
 * @property {string[]} names
 * @property {string} originalName
 * @property {PartialVersion | RequestedVersion} partialVersion
 */

/**
 * @typedef {object} Content
 * @property {string} name
 * @property {Version} version
 * @property {string} target
 * @property {string} ext
 */

/**
 * @typedef {object} RawPackage
 * @property {string} fullName
 * @property {Content} parsedContent
 * @property {string} fullUrl
 */

/**
 * @typedef {object} ResolvedPackage
 * @property {string} name
 * @property {Version} parsedVersion
 * @property {string} fullUrl
 */

/**
 * @param {string} inp
 * @returns {number}
 */
function parseIntSafe(inp) {
	const result = parseInt(inp)

	if (isNaN(result)) {
		throw new Error(`Not a avalid integer: '${inp}'`)
	}
	return result
}

/**
 * @param {string} inpName
 * @returns {Content|null}
 */
function parseContentFrom(inpName) {
	const result = inpName.match(
		/^(.*)\-(?:(\d*)\.(\d*)\.(\d*)\-(\d*))\-([^.]*)\.(.*)$/
	)

	if (result === null) {
		return null
	}

	const [_, pkgName, major, minor, patch, rev, target, ext, ...rest] = result

	if (rest.length != 0) {
		throw new Error("Implementation error, the match has an invalid length")
	}

	/** @type {Version} */
	const version = {
		major: parseIntSafe(major),
		minor: parseIntSafe(minor),
		patch: parseIntSafe(patch),
		rev: parseIntSafe(rev),
	}

	/** @type {Content} */
	const content = { ext, name: pkgName, target, version }

	return content
}

/**
 * @param {string} inpName
 * @returns {PartialVersion | RequestedVersion}
 */
function parsePartialVersion(inpName) {
	// ! means same as the rest e.g. for gcc and gcc-libs
	if (inpName == "!") {
		return { type: "requested", classification: "same_as_rest" }
	}

	/** @type {PartialVersion} */
	const version = {}

	//TODO: implement more than this

	if (inpName.match(/^(\d*)$/)) {
		version.major = parseIntSafe(inpName)
	}

	return version
}

/**
 * @param {MSystem} msystem
 * @returns {string}
 */
function getArchNameFromMSystem(msystem) {
	switch (msystem) {
		case "mingw32":
			return "i686"
		case "mingw64":
			return "x86_64"
		case "ucrt64":
			return "ucrt-x86_64"
		case "clang64":
			return "clang-x86_64"
		case "clangarm64":
			return "clang-aarch64"
		default:
			throw new Error(
				`UNREACHABLE MSystem '${msystem}' in switch case for getArchNameFromMSystem()`
			)
	}
}

/**
 * @param {string} input
 * @param {MSystem} msystem
 * @returns {string[]}
 */
function resolveNamesFromUerInputName(input, msystem) {
	const archName = getArchNameFromMSystem(msystem)

	const prefix = `mingw-w64-${archName}`

	if (input.startsWith(prefix)) {
		// if it already has a prefix, we don't strip it, as that would eb something else
		return [input]
	}

	return [input, `${prefix}-${input}`]
}

/**
 * @async
 * @param {string} spec
 * @param {MSystem} msystem
 * @returns {Package[]}
 */
function resolveRequestedPackages(spec, msystem) {
	const rawPackages = spec.split(" ")

	/** @type {Package[]} */
	const packages = rawPackages.map((inp) => {
		/** @type {Package} */
		const result = { originalName: "", names: [], partialVersion: {} }

		if (inp.includes("=")) {
			const [name1, ...rest] = inp.split("=")

			if (rest.length != 1) {
				throw new Error(`Invalid version specifier, it can't contain =`)
			}

			result.names = resolveNamesFromUerInputName(name1, msystem)
			result.originalName = name1
			result.partialVersion = parsePartialVersion(rest[0])
		} else {
			result.names = resolveNamesFromUerInputName(inp, msystem)
			result.originalName = inp
		}
		return result
	})

	return packages
}

/**
 * @async
 * @param {string} input
 * @param {MSystem} msystem
 * @returns {Package[][]}
 */
function resolveRequestedPackageSpecs(input, msystem) {
	const specs = input.replace(/\r/g, "\n").replace(/\n\n/g, "\n").split("\n")

	return specs.map((spec) => resolveRequestedPackages(spec, msystem))
}

/**
 * @param {string} html
 * @param {string} repoLink
 * @returns {RawPackage[]}
 */
function extractPackages(repoLink, html) {
	const parsedHtml = HTMLParser.parse(html)

	/**
	 * @param {HTMLParser.HTMLElement|null} element
	 * @param {string} message
	 * @returns {HTMLParser.HTMLElement}
	 */
	function parseAssert(element, message) {
		if (element === null) {
			throw new Error(
				`Failed in parsing the html file of the package list: ${message}`
			)
		}
		return element
	}

	const preElement = parseAssert(
		parsedHtml.querySelector("pre"),
		"pre element"
	)

	const parsedPreElement = HTMLParser.parse(preElement.textContent.trim())

	const packageElements = parsedPreElement.querySelectorAll("a")

	/** @type {RawPackage[]} */
	const packages = []

	for (const packageElement of packageElements) {
		const linkName = packageElement.attributes["href"]

		//TODO: use the sig to verify things later on
		if (linkName.endsWith(".sig")) {
			core.debug(`Skipped sig name ${linkName}`)
			continue
		}

		const parsedContent = parseContentFrom(linkName)

		if (parsedContent === null) {
			core.debug(`parsedContent is null for: '${linkName}'`)
			continue
		}

		const fullUrl = repoLink + linkName

		/** @type {RawPackage} */
		const pack = { fullName: linkName, fullUrl, parsedContent }

		packages.push(pack)
	}

	return packages
}

/**
 *
 * @param {Version} version
 * @returns {string}
 */
function versionToString(version) {
	return `v${version.major}.${version.minor}.${version.patch}-${version.rev}`
}

/**
 *
 * @param {Version | PartialVersion | RequestedVersion} version
 * @returns {string}
 */
function anyVersionToString(version) {
	if (isRequestedVersion(version)) {
		if (version.classification === "same_as_rest") {
			return "<same_as_rest>"
		}

		throw new Error(
			`Unhandled RequestedVersion: ${JSON.stringify(version)}`
		)
	}

	if (version.major === null || version.major === undefined) {
		return "<Empty version>"
	}

	if (version.minor === null || version.minor === undefined) {
		return `v${version.major}`
	}

	if (version.patch === null || version.patch === undefined) {
		return `v${version.major}.${version.minor}`
	}

	if (version.rev === null || version.rev === undefined) {
		return `v${version.major}.${version.minor}.${version.patch}`
	}

	return versionToString(/** @type {Version} */ (/** @type {any} */ version))
}

/**
 * @typedef {object} EqMatcher
 * @property {"eq"} type
 * @property {number} data
 */

/**
 * @typedef {object} AnyMatcher
 * @property {"any"} type
 */

/**
 * @typedef {EqMatcher | AnyMatcher} Matcher
 **/

/**
 * @typedef {[Matcher, Matcher, Matcher, Matcher]} Matchers
 **/

/**
 *
 * @param {Matcher} matcher
 * @param {number} value
 * @returns {boolean}
 */
function matchesMatcher(matcher, value) {
	if (matcher.type === "any") {
		return true
	}

	if (matcher.type === "eq") {
		return matcher.data === value
	}

	throw new Error(`Unrecognized matcher: ${JSON.stringify(matcher)}`)
}

/**
 *
 * @param {Version} version
 * @param {PartialVersion} partialVersion
 * @returns {boolean}
 */
function isCompatibleVersion(version, partialVersion) {
	/** @type {Matchers} */
	const matchers = [
		{ type: "any" },
		{ type: "any" },
		{ type: "any" },
		{ type: "any" },
	]

	if (partialVersion.major !== null && partialVersion.major !== undefined) {
		matchers[0] = { type: "eq", data: partialVersion.major }
	}

	if (partialVersion.minor !== null && partialVersion.minor !== undefined) {
		matchers[1] = { type: "eq", data: partialVersion.minor }
	}

	if (partialVersion.patch !== null && partialVersion.patch !== undefined) {
		matchers[2] = { type: "eq", data: partialVersion.patch }
	}

	if (partialVersion.rev !== null && partialVersion.rev !== undefined) {
		matchers[3] = { type: "eq", data: partialVersion.rev }
	}

	/** @type {[number, number, number, number]} */
	const versionArray = [
		version.major,
		version.minor,
		version.patch,
		version.rev,
	]

	for (let i = 0; i < 4; ++i) {
		const matcher = matchers[i]
		const versionNum = versionArray[i]

		if (!matchesMatcher(matcher, versionNum)) {
			return false
		}
	}

	return true
}

/**
 *
 * @param {RequestedVersion | Version | PartialVersion} version
 * @returns {version is RequestedVersion}
 */
function isRequestedVersion(version) {
	/** @type {RequestedVersion | {type:undefined}} */
	const v = /** @type {any} */ (version)

	return v.type === "requested"
}

const MAJOR_MULT = 10 ** 9
const MINOR_MULT = 10 ** 6
const PATCH_MULT = 10 ** 3
const REV_MULT = 1

/**
 *
 * @param {Version} version
 * @returns
 */
function getCompareNumberForVersion(version) {
	return (
		version.major * MAJOR_MULT +
		version.minor * MINOR_MULT +
		version.patch * PATCH_MULT +
		version.rev * REV_MULT
	)
}

/**
 *
 * @param {Package} requestedPackage
 * @param {RawPackage[]} allRawPackages
 * @param {Version[]} [prevVersions=[]]
 * @returns {ResolvedPackage}
 */
function resolveBestSuitablePackage(
	requestedPackage,
	allRawPackages,
	prevVersions = []
) {
	let requestedVersion = requestedPackage.partialVersion

	if (isRequestedVersion(requestedVersion)) {
		if (prevVersions.length == 0) {
			throw new Error(
				`While trying to resolve package '${requestedPackage.originalName}': Can't use a requested version for the first element`
			)
		}

		if (requestedVersion.classification === "same_as_rest") {
			const prevNumbers = prevVersions.map((prev) =>
				getCompareNumberForVersion(prev)
			)

			const areAllTheSame = prevNumbers.reduce(
				(acc, elem, _, allElems) => {
					if (!acc) {
						return acc
					}

					return elem === allElems[0]
				},
				true
			)

			if (!areAllTheSame) {
				throw new Error(
					`Selected RequestedVersion "same_as_rest" but not all packages with explicti version where the same, aborting.\n versions where: ${prevVersions.map((ver) => anyVersionToString(ver)).join(", ")}`
				)
			}

			requestedVersion = prevVersions[0]
		} else {
			throw new Error(
				`Unhandled RequestedVersion: ${JSON.stringify(requestedVersion)}`
			)
		}
	}

	/** @type {RawPackage[]} */
	const suitablePackages = []

	for (const pkg of allRawPackages) {
		if (pkg.parsedContent === null) {
			continue
		}

		if (!requestedPackage.names.includes(pkg.parsedContent.name)) {
			continue
		}

		if (!isCompatibleVersion(pkg.parsedContent.version, requestedVersion)) {
			continue
		}

		suitablePackages.push(pkg)
	}

	if (suitablePackages.length == 0) {
		core.info(
			`While searching for ${requestedPackage.names.join(
				", "
			)} ${anyVersionToString(requestedPackage.partialVersion)}`
		)
		throw new Error(
			`Can't resolve package ${
				requestedPackage.originalName
			} as no suitable packages where found online, requested version: ${anyVersionToString(
				requestedPackage.partialVersion
			)}`
		)
	}

	const sortedPackages = suitablePackages.sort((pkgA, pkgB) => {
		const comparNrA = pkgA.parsedContent
			? getCompareNumberForVersion(pkgA.parsedContent.version)
			: 0

		const comparNrB = pkgB.parsedContent
			? getCompareNumberForVersion(pkgB.parsedContent.version)
			: 0

		return comparNrB - comparNrA
	})

	const rawPackage = sortedPackages[0]

	core.info(
		`Resolved package ${requestedPackage.originalName} to '${rawPackage.fullName}'`
	)

	/** @type {ResolvedPackage} */
	const resolvedPackage = {
		fullUrl: rawPackage.fullUrl,
		name: rawPackage.fullName,
		parsedVersion: rawPackage.parsedContent?.version,
	}

	return resolvedPackage
}

/**
 *
 * @param {Package[]} requestedPackages
 * @param {RawPackage[]} allRawPackages
 * @returns {ResolvedPackage[]}
 */
function resolveBestSuitablePackages(requestedPackages, allRawPackages) {
	/**
	 *
	 * @param {ResolvedPackage[]} acc
	 * @param {Package} elem
	 * @returns {ResolvedPackage[]}
	 */
	function reduceFn(acc, elem) {
		/** @type {Version[]} */
		const prevVersions = acc.map((a) => a.parsedVersion)

		const result = resolveBestSuitablePackage(
			elem,
			allRawPackages,
			prevVersions
		)

		acc.push(result)

		return acc
	}

	return requestedPackages.reduce(reduceFn, [])
}

/**
 *
 * @param {Package[][]} requestedPackageSpecs
 * @param {RawPackage[]} allRawPackages
 * @returns {ResolvedPackage[][]}
 */
function resolveBestSuitablePackageSpecs(
	requestedPackageSpecs,
	allRawPackages
) {
	return requestedPackageSpecs.map((reqSpec) =>
		resolveBestSuitablePackages(reqSpec, allRawPackages)
	)
}

/**
 * @async
 * @param {string} input
 * @param {MSystem} msystem
 * @returns {Promise<ResolvedPackage[][]>}
 */
async function resolvePackageSpecs(input, msystem) {
	/** @type {Package[][]} */
	const requestedPackages = resolveRequestedPackageSpecs(input, msystem)

	/** @type {string} */
	const repoLink = `https://repo.msys2.org/mingw/${msystem}/`

	const httpClient = new http.HttpClient()

	const result = await httpClient.get(repoLink)

	if (result.message.statusCode != 200) {
		throw new Error(`Error in getting the package list: ${result.message}`)
	}

	const body = await result.readBody()

	const allRawPackages = extractPackages(repoLink, body)

	core.info(`Found ${allRawPackages.length} packages in total`)

	const selectedPackages = resolveBestSuitablePackageSpecs(
		requestedPackages,
		allRawPackages
	)

	return selectedPackages
}

/** @type {string|null} */
let cmd = null

/**
 *
 * @returns {void}
 */
function setupCmd() {
	//TODO: don't hardcode this path, see https://github.com/msys2/setup-msys2/blob/main/main.js

	const msysRootDir = path.join("C:", "msys64")

	const tmp_dir = process.env["RUNNER_TEMP"]
	if (!tmp_dir) {
		core.setFailed("environment variable RUNNER_TEMP is undefined")
		return
	}

	const pathDir = path.join(tmp_dir, "setup-msys2")

	cmd = path.join(pathDir, "msys2.cmd")
}

/**
 * @see https://github.com/msys2/setup-msys2/blob/main/main.js#L304
 * @param {string[]} args
 * @param {object} opts
 */
async function runMsys(args, opts) {
	assert.ok(cmd)
	const quotedArgs = args.map((arg) => {
		return `'${arg.replace(/'/g, `'\\''`)}'`
	}) // fix confused vim syntax highlighting with: `
	await exec.exec(
		"cmd",
		["/D", "/S", "/C", cmd].concat(["-c", quotedArgs.join(" ")]),
		opts
	)
}

/**
 * @see https://github.com/msys2/setup-msys2/blob/main/main.js#L310C1-L317C2
 * @param {string[]} args
 * @param {object} opts
 * @param {string} [cmd]
 */
async function pacman(args, opts, cmd) {
	await runMsys([cmd ? cmd : "pacman", "--noconfirm"].concat(args), opts)
}

/**
 *
 * @async
 * @param {string|null} folderOrEmpty
 * @returns {Promise<string>}
 */
async function resolveTempFolder(folderOrEmpty) {
	let finalFolder = folderOrEmpty

	if (finalFolder == null) {
		const tmpDir = process.env["RUNNER_TEMP"]
		if (!tmpDir) {
			throw new Error("environment variable RUNNER_TEMP is undefined")
		}

		await io.mkdirP(tmpDir)

		finalFolder = path.join(tmpDir, "msys2-pinned-packages")
	}

	await io.mkdirP(finalFolder)

	return finalFolder
}

/**
 *
 * @param {string} fileUrl
 * @param {string} fileName
 * @param {string|null} downloadFolder
 * @returns {Promise<string>}
 */
async function downloadFile(fileUrl, fileName, downloadFolder = null) {
	const folder = await resolveTempFolder(downloadFolder)
	const file = path.join(folder, fileName)
	const writeStream = fs.createWriteStream(file)

	const httpClient = new http.HttpClient()

	const result = await httpClient.get(fileUrl)

	if (result.message.statusCode != 200) {
		throw new Error(`Error in getting the file: ${fileUrl}`)
	}

	await /** @type {Promise<void>} */ (
		new Promise((resolve, reject) => {
			const stream = result.message.pipe(writeStream)

			stream.on("error", (err) => reject(err))
			stream.on("close", resolve)
		})
	)

	return file
}

/**
 *
 * @param {string} winPath
 * @returns {string}
 */
function windowsPathToLinuxPath(winPath) {
	// Normalize path separators and remove drive colon

	const path = winPath.replace(/\\/g, "/") // Convert backslashes to forward slashes

	const match = path.match(/^([a-zA-Z]):(\/.*)/)
	if (match !== null) {
		const driveLetter = match[1].toLowerCase()
		const rest = match[2]
		return `/${driveLetter}${rest}`
	} else {
		// If path doesn't match the expected pattern, return as-is
		return path
	}
}

/**
 * @async
 * @param {ResolvedPackage[]} pkgs
 * @returns {Promise<void>}
 */
async function installPackages(pkgs) {
	/** @type {[string[], string[]]} */
	const paths = [[], []]

	for (const pkg of pkgs) {
		core.info(`Downloading package '${pkg.name}' with url '${pkg.fullUrl}'`)
		const pkgPath = await downloadFile(pkg.fullUrl, pkg.name)
		const linuxPkgPath = windowsPathToLinuxPath(pkgPath)
		paths[0].push(linuxPkgPath)
		paths[1].push(pkgPath)
	}

	await pacman(["-U", ...paths[0]], {})

	for (const pkgPath of paths[1]) {
		await io.rmRF(pkgPath)
	}
}

/**
 *
 * @param {MSystem} msystem
 * @returns {Promise<void>}
 */
async function installPrerequisites(msystem) {
	// update package index
	await pacman(["-Sy"], {})

	const archName = getArchNameFromMSystem(msystem)

	const zstd_arch_package = `mingw-w64-${archName}-zstd`

	await pacman(
		["-Sy", "--needed", "zstd", "libzstd", "tar", zstd_arch_package],
		{}
	)
}

/**
 * @async
 * @param {ResolvedPackage[][]} packages
 * @param {MSystem} msystem
 * @returns {Promise<void>}
 */
async function installMultiplePackageSpecs(packages, msystem) {
	await installPrerequisites(msystem)

	for (const pkgs of packages) {
		await installPackages(pkgs)
	}
}

/**
 *
 * @param {string} input
 * @returns {MSystem}
 */
function toMSystem(input) {
	switch (input.toLowerCase()) {
		case "clang32":
			throw new Error(
				"MSystem 'clang32' is deprecated and can't be used anymore!"
			)
		case "mingw64arm":
			throw new Error("MSystem 'mingw64arm' is unimplemented for this!")
		case "msys":
			throw new Error("MSystem 'msys' is unimplemented for this!")
		case "mingw32":
		case "mingw64":
		case "ucrt64":
		case "clang64":
		case "clangarm64":
			return /** @type {MSystem} */ (
				/** @type {any} */ input.toLowerCase()
			)
		default:
			throw new Error(`'${input}' is no valid MSystem`)
	}
}

/**
 * @async
 * @returns {Promise<void>}
 */
async function main() {
	try {
		/** @type {string} */
		const os = core.platform.platform

		if (os != "win32") {
			throw new Error(
				`Action atm only supported on windows (win32): but are on: ${os}`
			)
		}

		/** @type {string} */
		const msystemInput = core.getInput("msystem", { required: false })

		/** @type {string} */
		const installInput = core.getInput("install", {
			required: true,
		})

		/** @type {MSystem} */
		const msystem = toMSystem(msystemInput)

		setupCmd()

		const packageSpecs = await resolvePackageSpecs(installInput, msystem)

		await installMultiplePackageSpecs(packageSpecs, msystem)
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(error)
		} else {
			core.setFailed(`Invalid error thrown: ${error}`)
		}
	}
}

;("gcc=14")
main()
