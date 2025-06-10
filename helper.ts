import HTMLParser from "node-html-parser"
import type { HTMLElement } from "node-html-parser"
import core from "@actions/core"
import * as http from "@actions/http-client"

export type MSystem =
	| "mingw32"
	| "mingw64"
	| "ucrt64"
	| "clang64"
	| "clangarm64"

export interface Version {
	major: number
	minor: number
	patch: number
	rev: number
}

export interface Content {
	name: string
	version: Version
	target: string
	ext: string
}

export interface RawPackage {
	fullName: string
	parsedContent: Content
	fullUrl: string
}

export interface ResolvedPackageNormal {
	type: "normal"
	name: string
	parsedVersion: Version
	fullUrl: string
}

export interface ResolvedPackageVirtual {
	type: "virtual"
	name: string
}

export type ResolvedPackage = ResolvedPackageNormal | ResolvedPackageVirtual

export interface PartialVersion {
	major?: number | null
	minor?: number | null
	patch?: number | null
	rev?: number | null
}

export interface RequestedVersionSameAsTheRest {
	type: "requested"
	classification: "same_as_rest"
}

export type RequestedVersion = RequestedVersionSameAsTheRest

export interface RequestedPackageNormal {
	type: "normal"
	names: string[]
	originalName: string
	partialVersion: PartialVersion | RequestedVersion
}

export interface RequestedPackageVirtual {
	type: "virtual"
	name: string
}

export type RequestedPackage = RequestedPackageNormal | RequestedPackageVirtual

export interface PackageResolveSettings {
	virtual: boolean
	prependPrefix: boolean
}

export interface PackageInput {
	name: string
	partialVersion: PartialVersion | RequestedVersion
	settings: PackageResolveSettings
}

export interface EqMatcher {
	type: "eq"
	data: number
}

export interface AnyMatcher {
	type: "any"
}

export type Matcher = EqMatcher | AnyMatcher

export type Matchers = [Matcher, Matcher, Matcher, Matcher]

function parseIntSafe(inp: string): number {
	const result = parseInt(inp)

	if (isNaN(result)) {
		throw new Error(`Not a valid integer: '${inp}'`)
	}
	return result
}

function parseContentFrom(inpName: string): Content | null {
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

	const version: Version = {
		major: parseIntSafe(major),
		minor: parseIntSafe(minor),
		patch: parseIntSafe(patch),
		rev: parseIntSafe(rev),
	}

	const content: Content = { ext, name: pkgName, target, version }

	return content
}

export interface SkipItem {
	name: string
	reason: string
}

export interface ExtractedPackagesErrors {
	skipped: SkipItem[]
	failed: string[]
}

export interface ExtractedPackagesReturnValue {
	errors: ExtractedPackagesErrors
	packages: RawPackage[]
}

export function extractPackages(
	repoLink: string,
	html: string
): ExtractedPackagesReturnValue {
	const parsedHtml = HTMLParser.parse(html)

	function parseAssert(
		element: HTMLElement | null,
		message: string
	): HTMLElement {
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

	const packages: RawPackage[] = []

	const errors: ExtractedPackagesErrors = { skipped: [], failed: [] }

	for (const packageElement of packageElements) {
		const rawLinkName = packageElement.attributes["href"]
		const linkName = decodeURIComponent(packageElement.attributes["href"])

		if (linkName.endsWith(".sig")) {
			//TODO: use the sig to verify things later on
			errors.skipped.push({ name: linkName, reason: "sig package" })
			continue
		} else if (linkName.endsWith(".db")) {
			errors.skipped.push({ name: linkName, reason: ".db file" })
			continue
		} else if (linkName.endsWith(".old")) {
			errors.skipped.push({ name: linkName, reason: ".old file" })
			continue
		} else if (linkName === "../") {
			errors.skipped.push({ name: linkName, reason: "directory file" })
			continue
		}

		const parsedContent = parseContentFrom(linkName)

		if (parsedContent === null) {
			errors.failed.push(linkName)
			continue
		}

		const fullUrl = repoLink + rawLinkName

		const pack: RawPackage = { fullName: linkName, fullUrl, parsedContent }

		packages.push(pack)
	}

	const result: ExtractedPackagesReturnValue = { packages, errors }

	return result
}

const EMPTY_PARTIAL_VERSION: PartialVersion = {}

const DEFAULT_SETTINGS: PackageResolveSettings = {
	prependPrefix: true,
	virtual: false,
}

function parseSettings(str: string): PackageResolveSettings {
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

function parsePartialVersion(
	inpName: string
): PartialVersion | RequestedVersion {
	// "!"" means same as the rest e.g. for gcc and gcc-libs
	if (inpName == "!") {
		return { type: "requested", classification: "same_as_rest" }
	}

	if (inpName === "") {
		return EMPTY_PARTIAL_VERSION
	}

	const version: PartialVersion = {}

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

function resolvePackageString(packageStr: string): PackageInput {
	const result: PackageInput = {
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

export function getArchNameFromMSystem(msystem: MSystem): string {
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

function resolveVirtualName(
	input: string,
	msystem: MSystem,
	prependPrefix: boolean
): string {
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

function resolveNamesFromUserInputName(
	input: string,
	msystem: MSystem,
	prependPrefix: boolean
): string[] {
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

function resolveRequestedPackages(
	spec: string,
	msystem: MSystem
): RequestedPackage[] {
	const rawPackages = spec.split(" ")

	const packages: RequestedPackage[] = rawPackages.map((inp) => {
		const packageInput = resolvePackageString(inp)

		if (packageInput.settings.virtual) {
			const virtualName: string = resolveVirtualName(
				packageInput.name,
				msystem,
				packageInput.settings.prependPrefix
			)

			const virtualPackage: RequestedPackageVirtual = {
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

		const normalPackage: RequestedPackageNormal = {
			type: "normal",
			names,
			originalName: packageInput.name,
			partialVersion: packageInput.partialVersion,
		}

		return normalPackage
	})

	return packages
}

function resolveRequestedPackageSpecs(
	input: string,
	msystem: MSystem
): RequestedPackage[][] {
	const specs = input.replace(/\r/g, "\n").replace(/\n\n/g, "\n").split("\n")

	return specs.map((spec) => resolveRequestedPackages(spec, msystem))
}

function isNormalResolvedPackage(
	resolvedPackage: ResolvedPackage
): resolvedPackage is ResolvedPackageNormal {
	return resolvedPackage.type === "normal"
}

function isRequestedVersion(
	version: RequestedVersion | Version | PartialVersion
): version is RequestedVersion {
	const v = version as unknown as RequestedVersion | { type: undefined }

	return v.type === "requested"
}

function versionToString(version: Version): string {
	return `v${version.major}.${version.minor}.${version.patch}-${version.rev}`
}

function anyVersionToString(
	version: Version | PartialVersion | RequestedVersion
): string {
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

	return versionToString(version as Version)
}

const MAJOR_MULT: number = 10 ** 9
const MINOR_MULT: number = 10 ** 6
const PATCH_MULT: number = 10 ** 3
const REV_MULT: number = 1

function getCompareNumberForVersion(version: Version) {
	return (
		version.major * MAJOR_MULT +
		version.minor * MINOR_MULT +
		version.patch * PATCH_MULT +
		version.rev * REV_MULT
	)
}

function matchesMatcher(matcher: Matcher, value: number): boolean {
	if (matcher.type === "any") {
		return true
	}

	if (matcher.type === "eq") {
		return matcher.data === value
	}

	throw new Error(`Unrecognized matcher: ${JSON.stringify(matcher)}`)
}

function isCompatibleVersion(
	version: Version,
	partialVersion: PartialVersion
): boolean {
	const matchers: Matchers = [
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

	const versionArray: [number, number, number, number] = [
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

function resolveBestSuitablePackage(
	requestedPackage: RequestedPackage,
	allRawPackages: RawPackage[],
	prevVersions: Version[] = []
): ResolvedPackage {
	if (requestedPackage.type === "virtual") {
		const virtualResolvedPackage: ResolvedPackageVirtual = {
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

	const suitablePackages: RawPackage[] = []

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

	const resolvedPackageNormal: ResolvedPackageNormal = {
		type: "normal",
		fullUrl: rawPackage.fullUrl,
		name: rawPackage.fullName,
		parsedVersion: rawPackage.parsedContent?.version,
	}

	return resolvedPackageNormal
}

function resolveBestSuitablePackages(
	requestedPackages: RequestedPackage[],
	allRawPackages: RawPackage[]
): ResolvedPackage[] {
	function reduceFn(
		acc: ResolvedPackage[],
		elem: RequestedPackage
	): ResolvedPackage[] {
		const prevVersions: Version[] = acc
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

function resolveBestSuitablePackageSpecs(
	requestedPackageSpecs: RequestedPackage[][],
	allRawPackages: RawPackage[]
): ResolvedPackage[][] {
	return requestedPackageSpecs.map((reqSpec) =>
		resolveBestSuitablePackages(reqSpec, allRawPackages)
	)
}

export function getRepoLink(msystem: MSystem): string {
	const repoLink: string = `https://repo.msys2.org/mingw/${msystem}/`

	return repoLink
}

export async function getRawBody(repoLink: string): Promise<string> {
	const httpClient = new http.HttpClient()

	const result = await httpClient.get(repoLink)

	if (result.message.statusCode != 200) {
		throw new Error(`Error in getting the package list: ${result.message}`)
	}

	const body = await result.readBody()

	return body
}

export async function resolvePackageSpecs(
	input: string,
	msystem: MSystem
): Promise<ResolvedPackage[][]> {
	const requestedPackages: RequestedPackage[][] =
		resolveRequestedPackageSpecs(input, msystem)

	const repoLink: string = getRepoLink(msystem)

	const body: string = await getRawBody(repoLink)

	const result: ExtractedPackagesReturnValue = extractPackages(repoLink, body)

	for (const failed of result.errors.failed) {
		core.debug(`failed to parse package from name for: '${failed}'`)
	}

	for (const { name, reason } of result.errors.skipped) {
		core.debug(`Skipped package name ${name} because of: ${reason}`)
	}

	const allRawPackages: RawPackage[] = result.packages

	core.info(`Found ${allRawPackages.length} packages in total`)

	const selectedPackages = resolveBestSuitablePackageSpecs(
		requestedPackages,
		allRawPackages
	)

	return selectedPackages
}
