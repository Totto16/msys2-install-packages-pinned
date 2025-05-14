"strict"

const core = require("@actions/core")
const exec = require("@actions/exec")
const io = require("@actions/io")
const http = require("@actions/http-client")
const HTMLParser = require("node-html-parser")

/**
 * @typedef {"msys" | "mingw32" | "mingw64" | "ucrt64" | "clang64" | "clangarm64"} MSystem
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
 * @property {string} name
 * @property {PartialVersion} partialVersion
 */

/**
 * @typedef {object} RawPackage
 * @property {string} fullName
 * @property {Version|null} parsedVersion
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
 * @returns {Version|null}
 */
function parseVersionFrom(inpName) {
	const result = inpName.match(/^.*(?:(\d*)\.(\d*)\.(\d*)\-(\d*)).*$/)

	if (result === null) {
		return null
	}

	const [_, major, minor, patch, rev, ...rest] = result

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

	return version
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
 * @async
 * @param {string} input
 * @returns {Package[]}
 */
function resolveRequestedPackages(input) {
	const rawPackages = input.split(" ")

	/** @type {Package[]} */
	const packages = rawPackages.map((inp) => {
		/** @type {Package} */
		const result = { name: "", partialVersion: {} }

		if (inp.includes("=")) {
			const [name1, ...rest] = inp.split("=")

			if (rest.length != 1) {
				throw new Error(`Invalid version specifier, it can't contain =`)
			}

			result.name = name1
			result.partialVersion = parsePartialVersion(rest[0])
		} else {
			result.name = inp
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

	const packageElements = preElement.querySelectorAll("a")

	/** @type {RawPackage[]} */
	const packages = []

	for (const packageElement of packageElements) {
		const linkName = packageElement.attributes["href"]

		//TODO: use the sig to verify things later on
		if (linkName.endsWith(".sig")) {
			continue
		}

		const parsedVersion = parseVersionFrom(linkName)
		const fullUrl = repoLink + linkName

		/** @type {RawPackage} */
		const pack = { fullName: linkName, fullUrl, parsedVersion }

		packages.push(pack)
	}

	return packages
}

/**
 *
 * @param {Package} requestedPackage
 * @param {RawPackage[]} allRawPackages
 * @returns {ResolvedPackage}
 */
function resolveBestSuitablePackage(requestedPackage, allRawPackages) {
	throw new Error("TODO")
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
	const requestedPackages = resolveRequestedPackages(input)

	/** @type {string} */
	const repoLink = `https://repo.msys2.org/mingw/${msystem}/`

	const httpClient = new http.HttpClient()

	const result = await httpClient.get(repoLink)

	if (result.message.statusCode != 200) {
		throw new Error(`Error in getting the package list: ${result.message}`)
	}

	const body = await result.readBody()

	const allRawPackages = extractPackages(repoLink, body)

	const selectedPackages = resolveBestSuitablePackages(
		requestedPackages,
		allRawPackages
	)

	return selectedPackages
}

/**
 * @async
 * @param {ResolvedPackage[]} packages
 * @returns {Promise<void>}
 */
async function installPackages(packages) {
	throw new Error("TODO")
}

/**
 *
 * @param {string} input
 * @returns {MSystem}
 */
function toMSystem(input) {
	switch (input.toLowerCase()) {
		case "msys":
		case "mingw32":
		case "mingw64":
		case "ucrt64":
		case "clang64":
		case "clangarm64":
			return /** @type {MSystem} */ (/** @type {any} */ input)
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

		if (os != "windows") {
			throw new Error(
				`Action atm only supported on windows: but are on: ${os}`
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
