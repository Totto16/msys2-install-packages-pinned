"strict"

const assert = require("node:assert/strict")
const core = require("@actions/core")
const exec = require("@actions/exec")
const fsAsync = require("node:fs/promises")
const HTMLParser = require("node-html-parser")
const http = require("@actions/http-client")
const io = require("@actions/io")
const os = require("os")
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
 * @typedef {object} Package
 * @property {string[]} names
 * @property {string} originalName
 * @property {PartialVersion} partialVersion
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
 * @returns {PartialVersion}
 */
function parsePartialVersion(inpName) {
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
 * @param {string} input
 * @param {MSystem} msystem
 * @returns {Package[]}
 */
function resolveRequestedPackages(input, msystem) {
	const rawPackages = input.split(" ")

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
 * @param {Version|PartialVersion} version
 * @returns {string}
 */
function anyVersionToString(version) {
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

const MAJOR_MULT = 10 ** 9
const MINOR_MULT = 10 ** 6
const PATCH_MULT = 10 ** 3
const REV_MULT = 1

/**
 *
 * @param {Package} requestedPackage
 * @param {RawPackage[]} allRawPackages
 * @returns {ResolvedPackage}
 */
function resolveBestSuitablePackage(requestedPackage, allRawPackages) {
	/** @type {RawPackage[]} */
	const suitablePackages = []

	for (const pkg of allRawPackages) {
		if (pkg.parsedContent === null) {
			continue
		}

		if (!requestedPackage.names.includes(pkg.parsedContent.name)) {
			continue
		}

		if (
			!isCompatibleVersion(
				pkg.parsedContent.version,
				requestedPackage.partialVersion
			)
		) {
			continue
		}

		suitablePackages.push(pkg)
	}

	if (suitablePackages.length == 0) {
		core.info(
			`While searching for ${requestedPackage.names.join(", ")} ${anyVersionToString(requestedPackage.partialVersion)}`
		)
		throw new Error(
			`Can't resolve package ${requestedPackage.originalName} as no suitable packages where found online, requested version: ${anyVersionToString(requestedPackage.partialVersion)}`
		)
	}

	//TODO: sort by matching of partialVersions e.g. 14 prefers 14.2 over 14.1, test if this is implemented correctly
	/**
	 *
	 * @param {Content} content
	 * @returns
	 */
	function getCompareNumberFor(content) {
		return (
			content.version.major * MAJOR_MULT +
			content.version.minor * MINOR_MULT +
			content.version.patch * PATCH_MULT +
			content.version.rev * REV_MULT
		)
	}

	const sortedPackages = suitablePackages.sort((pkgA, pkgB) => {
		const comparNrA = pkgA.parsedContent
			? getCompareNumberFor(pkgA.parsedContent)
			: 0

		const comparNrB = pkgB.parsedContent
			? getCompareNumberFor(pkgB.parsedContent)
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
	return requestedPackages.map((req) =>
		resolveBestSuitablePackage(req, allRawPackages)
	)
}

/**
 * @async
 * @param {string} input
 * @param {MSystem} msystem
 * @returns {Promise<ResolvedPackage[]>}
 */
async function resolvePackages(input, msystem) {
	/** @type {Package[]} */
	const requestedPackages = resolveRequestedPackages(input, msystem)

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

	const selectedPackages = resolveBestSuitablePackages(
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
	//TODO: donm't hardcode this path, see https://github.com/msys2/setup-msys2/blob/main/main.js

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
		const tmpDir = process.env.RUNNER_TEMP || os.tmpdir()
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
	const httpClient = new http.HttpClient()

	const result = await httpClient.get(fileUrl)

	if (result.message.statusCode != 200) {
		throw new Error(`Error in getting the file: ${fileUrl}`)
	}

	const body = await result.readBody()

	const folder = await resolveTempFolder(downloadFolder)

	const file = path.join(folder, fileName)

	await fsAsync.writeFile(file, body)

	return file
}

/**
 * @async
 * @param {ResolvedPackage} pkg
 * @returns {Promise<void>}
 */
async function installPackage(pkg) {
	core.info(`Downloading package '${pkg.name}' with url '${pkg.fullUrl}'`)
	const pkgPath = await downloadFile(pkg.fullUrl, pkg.name)

	core.info(`pkgPath is '${pkgPath}'`)

	await pacman(["-U", "--needed", "--overwrite", pkgPath], {})

	await io.rmRF(pkgPath)
}

/**
 * @async
 * @param {ResolvedPackage[]} packages
 * @returns {Promise<void>}
 */
async function installPackages(packages) {
	for (const pkg of packages) {
		await installPackage(pkg)
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

		const packages = await resolvePackages(installInput, msystem)

		await installPackages(packages)
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
