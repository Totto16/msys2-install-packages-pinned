const HTMLParser = require("node-html-parser")
const core = require("@actions/core")
const http = require("@actions/http-client")

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
 * @exports
 * @typedef {object} ResolvedPackageNormal
 * @property {"normal"} type
 * @property {string} name
 * @property {Version} parsedVersion
 * @property {string} fullUrl
 */

/**
 * @exports
 * @typedef {object} ResolvedPackageVirtual
 * @property {"virtual"} type
 * @property {string} name
 */

/**
 * @exports
 * @typedef {ResolvedPackageNormal | ResolvedPackageVirtual} ResolvedPackage
 **/

/**
 * @exports
 * @typedef {object} PartialVersion
 * @property {number|null} [major]
 * @property {number|null} [minor]
 * @property {number|null} [patch]
 * @property {number|null} [rev]
 */

/**
 * @exports
 * @typedef {object} RequestedVersionSameAsTheRest
 * @property {"requested"} type
 * @property {"same_as_rest"} classification
 */

/**
 * @exports
 * @typedef {RequestedVersionSameAsTheRest} RequestedVersion
 */

/**
 * @exports
 * @typedef {object} RequestedPackageNormal
 * @property {"normal"} type
 * @property {string[]} names
 * @property {string} originalName
 * @property {PartialVersion | RequestedVersion} partialVersion
 */

/**
 * @exports
 * @typedef {object} RequestedPackageVirtual
 * @property {"virtual"} type
 * @property {string} name
 */

/**
 * @exports
 * @typedef {RequestedPackageNormal | RequestedPackageVirtual} RequestedPackage
 **/

/**
 * @exports
 * @typedef {object} PackageResolveSettings
 * @property {boolean} virtual
 * @property {boolean} prependPrefix
 */

/**
 * @exports
 * @typedef {object} PackageInput
 * @property {string} name
 * @property {PartialVersion | RequestedVersion} partialVersion
 * @property {PackageResolveSettings} settings
 */

/**
 * @exports
 * @typedef {object} EqMatcher
 * @property {"eq"} type
 * @property {number} data
 */

/**
 * @exports
 * @typedef {object} AnyMatcher
 * @property {"any"} type
 */

/**
 * @exports
 * @typedef {EqMatcher | AnyMatcher} Matcher
 **/

/**
 * @exports
 * @typedef {[Matcher, Matcher, Matcher, Matcher]} Matchers
 **/

/**
 * @param {string} inp
 * @returns {number}
 */
function parseIntSafe(inp) {
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
 * @exports
 * @typedef {object} SkipItem
 * @property {string} name
 * @property {string} reason
 */

/**
 * @exports
 * @typedef {object} ExtractedPackagesErrors
 * @property {SkipItem[]} skipped
 * @property {string[]} failed
 */

/**
 * @exports
 * @typedef {object} ExtractedPackagesReturnValue
 * @property {ExtractedPackagesErrors} errors
 * @property {RawPackage[]} packages
 */

/**
 * @exports
 * @param {string} html
 * @param {string} repoLink
 * @returns {ExtractedPackagesReturnValue}
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

	/** @type {ExtractedPackagesErrors} */
	const errors = { skipped: [], failed: [] }

	for (const packageElement of packageElements) {
		const rawLinkName = packageElement.attributes["href"]
		const linkName = decodeURIComponent(packageElement.attributes["href"])

		//TODO: use the sig to verify things later on
		if (linkName.endsWith(".sig")) {
			/** @type {SkipItem} */
			const skip = { name: linkName, reason: "sig packages" }

			errors.skipped.push(skip)
			continue
		}

		const parsedContent = parseContentFrom(linkName)

		if (parsedContent === null) {
			errors.failed.push(linkName)
			continue
		}

		const fullUrl = repoLink + rawLinkName

		/** @type {RawPackage} */
		const pack = { fullName: linkName, fullUrl, parsedContent }

		packages.push(pack)
	}

	/** @type {ExtractedPackagesReturnValue} */
	const result = { packages, errors }

	return result
}

/** @type {PartialVersion} */
const EMPTY_PARTIAL_VERSION = {}

/** @type {PackageResolveSettings} */
const DEFAULT_SETTINGS = { prependPrefix: true, virtual: false }

/**
 *
 * @param {string} str
 * @returns {PackageResolveSettings}
 */
function parseSettings(str) {
	const settings = DEFAULT_SETTINGS

	for (const char of str) {
		switch (char) {
			case "v": {
				settings.virtual = true
				break
			}
			case "n": {
				settings.prependPrefix = false
				break
			}
			default: {
				throw new Error(`Invalid settings char: '${char}'`)
			}
		}
	}

	return settings
}

/**
 * @param {string} inpName
 * @returns {PartialVersion | RequestedVersion}
 */
function parsePartialVersion(inpName) {
	// "!"" means same as the rest e.g. for gcc and gcc-libs
	if (inpName == "!") {
		return { type: "requested", classification: "same_as_rest" }
	}

	if (inpName === "") {
		return EMPTY_PARTIAL_VERSION
	}

	/** @type {PartialVersion} */
	const version = {}

	const result = inpName.match(/^(\d*)(?:\.(\d*)(?:\.(\d*)(?:\-(\d*))?)?)?$/)

	if (result === null) {
		throw new Error(`Invalid partial version specifier: '${inpName}'`)
	}

	const [_, major, minor, patch, rev, ...rest] = result

	if (rest.length != 0) {
		throw new Error("Implementation error, the match has an invalid length")
	}

	if (major !== undefined) {
		version.major = parseIntSafe(major)
	}

	if (minor !== undefined) {
		version.minor = parseIntSafe(minor)
	}

	if (patch !== undefined) {
		version.patch = parseIntSafe(patch)
	}

	if (rev !== undefined) {
		version.rev = parseIntSafe(rev)
	}

	return version
}

/**
 *
 * @param {string} packageStr
 * @returns {PackageInput}
 */
function resolvePackageString(packageStr) {
	/** @type {PackageInput} */
	const result = {
		name: "",
		partialVersion: EMPTY_PARTIAL_VERSION,
		settings: DEFAULT_SETTINGS,
	}

	if (packageStr.includes("=")) {
		const [name1, ...rest1] = packageStr.split("=")

		if (rest1.length != 1) {
			throw new Error(`Invalid version specifier, it can't contain =`)
		}

		result.name = name1

		const restStr = rest1[0]

		if (restStr.includes(":")) {
			const [version1, ...rest2] = restStr.split(":")

			if (rest2.length != 1) {
				throw new Error(
					`Invalid settings specifier, it can't contain :`
				)
			}

			result.partialVersion = parsePartialVersion(version1)

			const settingsStr = rest2[0]

			result.settings = parseSettings(settingsStr)
		} else {
			result.partialVersion = parsePartialVersion(restStr)
		}
	} else {
		result.name = packageStr
	}

	return result
}

/**
 * @param {MSystem} msystem
 * @returns {string}
 */
export function getArchNameFromMSystem(msystem) {
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
 * @param {boolean} prependPrefix
 * @returns {string}
 */
function resolveVirtualName(input, msystem, prependPrefix) {
	const archName = getArchNameFromMSystem(msystem)

	const prefix = `mingw-w64-${archName}`

	if (input.startsWith(prefix)) {
		// if it already has a prefix, we don't strip it, as that would be something else
		return input
	}

	if (prependPrefix) {
		return `${prefix}-${input}`
	}

	return input
}

/**
 * @param {string} input
 * @param {MSystem} msystem
 * @param {boolean} prependPrefix
 * @returns {string[]}
 */
function resolveNamesFromUserInputName(input, msystem, prependPrefix) {
	const archName = getArchNameFromMSystem(msystem)

	const prefix = `mingw-w64-${archName}`

	if (input.startsWith(prefix)) {
		// if it already has a prefix, we don't strip it, as that would be something else
		return [input]
	}

	if (!prependPrefix) {
		return [input]
	}

	return [input, `${prefix}-${input}`]
}

/**
 * @async
 * @param {string} spec
 * @param {MSystem} msystem
 * @returns {RequestedPackage[]}
 */
function resolveRequestedPackages(spec, msystem) {
	const rawPackages = spec.split(" ")

	/** @type {RequestedPackage[]} */
	const packages = rawPackages.map((inp) => {
		const packageInput = resolvePackageString(inp)

		if (packageInput.settings.virtual) {
			/** @type {string} */
			const virtualName = resolveVirtualName(
				packageInput.name,
				msystem,
				packageInput.settings.prependPrefix
			)

			/** @type {RequestedPackageVirtual} */
			const virtualPackage = {
				type: "virtual",
				name: virtualName,
			}
			return virtualPackage
		}

		const names = resolveNamesFromUserInputName(
			packageInput.name,
			msystem,
			packageInput.settings.prependPrefix
		)

		/** @type {RequestedPackageNormal} */
		const normalPackage = {
			type: "normal",
			names,
			originalName: packageInput.name,
			partialVersion: packageInput.partialVersion,
		}

		return normalPackage
	})

	return packages
}

/**
 * @async
 * @param {string} input
 * @param {MSystem} msystem
 * @returns {RequestedPackage[][]}
 */
function resolveRequestedPackageSpecs(input, msystem) {
	const specs = input.replace(/\r/g, "\n").replace(/\n\n/g, "\n").split("\n")

	return specs.map((spec) => resolveRequestedPackages(spec, msystem))
}

/**
 *
 * @param {ResolvedPackage} resolvedPackage
 * @returns {resolvedPackage is ResolvedPackageNormal}
 */
function isNormalResolvedPackage(resolvedPackage) {
	return resolvedPackage.type === "normal"
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

/** @type {number} */
const MAJOR_MULT = 10 ** 9
/** @type {number} */
const MINOR_MULT = 10 ** 6
/** @type {number} */
const PATCH_MULT = 10 ** 3
/** @type {number} */
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
 * @param {RequestedPackage} requestedPackage
 * @param {RawPackage[]} allRawPackages
 * @param {Version[]} [prevVersions=[]]
 * @returns {ResolvedPackage}
 */
function resolveBestSuitablePackage(
	requestedPackage,
	allRawPackages,
	prevVersions = []
) {
	if (requestedPackage.type === "virtual") {
		/** @type {ResolvedPackageVirtual} */
		const virtualResolvedPackage = {
			type: "virtual",
			name: requestedPackage.name,
		}
		return virtualResolvedPackage
	}

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
		`Resolved package ${requestedPackage.originalName} with version ${anyVersionToString(requestedPackage.partialVersion)} to '${rawPackage.fullName}'`
	)

	/** @type {ResolvedPackageNormal} */
	const resolvedPackageNormal = {
		type: "normal",
		fullUrl: rawPackage.fullUrl,
		name: rawPackage.fullName,
		parsedVersion: rawPackage.parsedContent?.version,
	}

	return resolvedPackageNormal
}

/**
 *
 * @param {RequestedPackage[]} requestedPackages
 * @param {RawPackage[]} allRawPackages
 * @returns {ResolvedPackage[]}
 */
function resolveBestSuitablePackages(requestedPackages, allRawPackages) {
	/**
	 *
	 * @param {ResolvedPackage[]} acc
	 * @param {RequestedPackage} elem
	 * @returns {ResolvedPackage[]}
	 */
	function reduceFn(acc, elem) {
		/** @type {Version[]} */
		const prevVersions = acc
			.filter(isNormalResolvedPackage)
			.map((resolvedPackage) => resolvedPackage.parsedVersion)

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
 * @param {RequestedPackage[][]} requestedPackageSpecs
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
 *
 * @param {MSystem} msystem
 * @returns {string}
 */
export function getRepoLink(msystem) {
	/** @type {string} */
	const repoLink = `https://repo.msys2.org/mingw/${msystem}/`

	return repoLink
}

/**
 * @async
 * @param {string} repoLink
 * @returns {Promise<string>}
 */
export async function getRawBody(repoLink) {
	const httpClient = new http.HttpClient()

	const result = await httpClient.get(repoLink)

	if (result.message.statusCode != 200) {
		throw new Error(`Error in getting the package list: ${result.message}`)
	}

	const body = await result.readBody()

	return body
}

/**
 * @async
 * @param {string} input
 * @param {MSystem} msystem
 * @returns {Promise<ResolvedPackage[][]>}
 */
export async function resolvePackageSpecs(input, msystem) {
	/** @type {RequestedPackage[][]} */
	const requestedPackages = resolveRequestedPackageSpecs(input, msystem)

	/** @type {string} */
	const repoLink = getRepoLink(msystem)

	/** @type {string} */
	const body = await getRawBody(repoLink)

	/** @type {ExtractedPackagesReturnValue} */
	const result = extractPackages(repoLink, body)

	for (const failed of result.errors.failed) {
		core.debug(`failed to parse package from name for: '${failed}'`)
	}

	for (const { name, reason } of result.errors.skipped) {
		core.debug(`Skipped package name ${name} because of: ${reason}`)
	}

	/** @type {RawPackage[]} */
	const allRawPackages = result.packages

	core.info(`Found ${allRawPackages.length} packages in total`)

	const selectedPackages = resolveBestSuitablePackageSpecs(
		requestedPackages,
		allRawPackages
	)

	return selectedPackages
}
