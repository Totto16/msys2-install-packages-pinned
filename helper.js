const HTMLParser = require("node-html-parser")
const core = require("@actions/core")

/**
 * @exports
 * @typedef {"mingw32" | "mingw64" | "ucrt64" | "clang64" | "clangarm64"} MSystem
 **/

/**
 * @exports
 * @typedef {object} Version
 * @property {number} major
 * @property {number} minor
 * @property {number} patch
 * @property {number} rev
 */

/**
 * @exports
 * @typedef {object} Content
 * @property {string} name
 * @property {Version} version
 * @property {string} target
 * @property {string} ext
 */

/**
 * @exports
 * @typedef {object} RawPackage
 * @property {string} fullName
 * @property {Content} parsedContent
 * @property {string} fullUrl
 */

/**
 * @param {string} inp
 * @returns {number}
 */
export function parseIntSafe(inp) {
	const result = parseInt(inp)

	if (isNaN(result)) {
		throw new Error(`Not a valid integer: '${inp}'`)
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
 * @param {string} html
 * @param {string} repoLink
 * @returns {RawPackage[]}
 */
export function extractPackages(repoLink, html) {
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
		const rawLinkName = packageElement.attributes["href"]
		const linkName = decodeURIComponent(packageElement.attributes["href"])

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

		const fullUrl = repoLink + rawLinkName

		/** @type {RawPackage} */
		const pack = { fullName: linkName, fullUrl, parsedContent }

		packages.push(pack)
	}

	return packages
}
