import {
	anyVersionToString,
	extractPackages,
	getPrefixFromMSystem,
	getRawBody,
	getRepoLink,
	getSuitablePackages,
	MSystem,
	resolveNamesFromUserInputName,
	resolveRequestedPackageSpecs,
	type ExtractedPackagesReturnValue,
	type PartialVersion,
	type RawPackage,
	type RequestedPackage,
	type RequestedPackageNormal,
} from "./helper"

type TestCase = {
	architecture: MSystem
	invalidPackages: (string | RegExp)[]
}

const commonRegexes: RegExp[] = [
	/^(.*)\-(?:(\d*)\.(\d*)(?:\.(\d*))?(.*)\-(\d*))\-([^.]*)\.(.*)$/, // suffix after version
	/^(.*)\-(?:(\d*~)?(\d*)\.(\d*)(?:\.(\d*)(?:\.(\d*))?)?\-(\d*))\-([^.]*)\.(.*)$/, // <number>~ prefix + 4 numbers
	/^(.*)\-(?:([0-9a-fA-Fr+]*)\.([0-9a-fA-Fr+]*)(?:\.([0-9a-fA-Fr+]*))?\-([0-9a-fA-Fr+]*))\-([^.]*)\.(.*)$/, // also allow hex numbers + r for revision + "+"
]

function escapeForRegex(inp: string) {
	return inp.replace(/(\\|\-|\.)/g, (char) => {
		return `\\${char}`
	})
}

function generateRegexForUnknownVersion(
	msystem: MSystem,
	packages: string[]
): RegExp {
	const prefix = getPrefixFromMSystem(msystem)
	const packagesRegex = packages.map(escapeForRegex).join("|")
	return RegExp(
		`^${escapeForRegex(prefix)}\-(${packagesRegex}).*\-${escapeForRegex("any.pkg.tar.zst")}`
	)
}

//TODO: implement tests for the other architectures (atm not done, since a single test takes really long)
const testCases: TestCase[] = [
	//{ architecture: "mingw32", invalidPackages: [...commonRegexes] },
	//{ architecture: "mingw64", invalidPackages: [...commonRegexes] },
	//{ architecture: "ucrt64", invalidPackages: [...commonRegexes] },
	{
		architecture: "clang64",
		invalidPackages: [
			...commonRegexes,
			"clang64.db.tar.zst",
			"clang64.files",
			"clang64.files.tar.zst",
			generateRegexForUnknownVersion("clang64", [
				"alure2",
				"argon2",
				"aspell",
				"binaryen",
				"bmake",
				"bootloadhid",
				"ca-certificates",
				"cppreference-qt",
				"dnssec-anchors",
				"f2c",
				"fontforge",
				"gitg",
				"glsl-optimizer",
				"gsfonts",
				"hid-bootloader",
				"hlsl2glsl-git",
				"lammps",
				"libgoom2",
				"libinih",
				"libmpcdec",
				"libreplaygain",
				"libspiro",
				"libuninameslist",
				"llama.cpp",
				"ngspice",
				"opengl-man",
				"perl-mozilla",
				"python-diff",
				"python-pyproject2setuppy",
				"python-pywin32",
				"python-starlette",
				"re2",
				"rust-analyzer",
				"tclvfs-cvs",
				"trompeloeil",
				"tzdata",
				"vapoursynth",
				"wasi-libc",
				"whisper.cpp",
			]),
		],
	},
	//{ architecture: "clangarm64", invalidPackages: [...commonRegexes] },
]

const validReasons: string[] = [
	"sig package",
	".db file",
	".old file",
	"directory file",
]

expect.extend({
	toOnlyHavePackages(received: string[], expected: (string | RegExp)[]) {
		const expectedStrings: string[] = []
		const expectedRegexes: RegExp[] = []

		for (const exp of expected) {
			if (typeof exp === "string") {
				expectedStrings.push(exp)
			} else {
				expectedRegexes.push(exp)
			}
		}

		const remainingPackages = received.filter((pkg) => {
			if (expectedStrings.includes(pkg)) {
				return false
			}

			for (const regex of expectedRegexes) {
				if (pkg.match(regex)) {
					return false
				}
			}

			return true
		})

		if (remainingPackages.length === 0) {
			return {
				message: () =>
					`expected only invalid packages to be flagged as such ones`,
				pass: true,
			}
		} else {
			return {
				message: () =>
					`Some packages where incorrectly flagged as invalid: ${remainingPackages.map((pkg) => `"${pkg}"`).join(", ")}\nThe amount of invalid packages was ${remainingPackages.length}`,
				pass: false,
			}
		}
	},
	toFindPackage(
		allPackages: RawPackage[],
		name: string,
		msystem: MSystem,
		version?: PartialVersion
	) {
		const requestedPackage: RequestedPackageNormal = {
			type: "normal",
			names: resolveNamesFromUserInputName(name, msystem, true),
			originalName: name,
			partialVersion: version ?? {},
		}

		const foundPackages: RawPackage[] = getSuitablePackages(
			requestedPackage,
			allPackages,
			[]
		)

		if (foundPackages.length === 0) {
			return {
				message: () =>
					`Didn't find package '${name}' with version ${anyVersionToString(version ?? {})}`,
				pass: false,
			}
		} else {
			return {
				message: () =>
					`Found package '${name}' with version ${anyVersionToString(version ?? {})}`,
				pass: true,
			}
		}
	},
})

function hasClang(msystem: MSystem): boolean {
	return ["clang64", "clangarm64"].includes(msystem)
}

function hasGcc(msystem: MSystem): boolean {
	return ["mingw32", "mingw64", "ucrt64"].includes(msystem)
}

describe.each(testCases)(
	"helper module for arch '$architecture'",
	({ architecture, invalidPackages }) => {
		test(
			"fetching packages works as expected",
			async (): Promise<void> => {
				const repoLink: string = getRepoLink(architecture)

				const body: string = await getRawBody(repoLink)

				const result: ExtractedPackagesReturnValue = extractPackages(
					repoLink,
					body
				)

				for (const skipped of result.errors.skipped) {
					expect(validReasons).toContain(skipped.reason)
				}

				expect(result.errors.failed).toOnlyHavePackages(invalidPackages)

				if (hasClang(architecture)) {
					expect(result.packages).toFindPackage(
						"libc++",
						architecture,
						{
							major: 19,
						}
					)
					expect(result.packages).toFindPackage(
						"clang",
						architecture,
						{
							major: 19,
						}
					)

					expect(result.packages).toFindPackage(
						"libc++",
						architecture,
						{
							major: 20,
						}
					)
					expect(result.packages).toFindPackage(
						"clang",
						architecture,
						{
							major: 20,
						}
					)
				}

				if (hasGcc(architecture)) {
					expect(result.packages).toFindPackage("gcc", architecture, {
						major: 14,
					})
					expect(result.packages).toFindPackage(
						"gcc-libs",
						architecture,
						{ major: 14 }
					)

					expect(result.packages).toFindPackage("gcc", architecture, {
						major: 15,
					})
					expect(result.packages).toFindPackage(
						"gcc-libs",
						architecture,
						{ major: 15 }
					)
				}
			},
			60 * 1000
		)
	}
)

type ParseTest = {
	name: string
	input: string
	result: RequestedPackage[][]
}

const msystems: MSystem[] = [
	"mingw32",
	"mingw64",
	"ucrt64",
	"clang64",
	"clangarm64",
]

describe.each(msystems)("parse tests for %s", (msystem: MSystem): void => {
	const parseTestCases: ParseTest[] = [
		{
			name: "clang 20",
			input: `
	clang=20\r\n\tlibc++=20 libunwind=20:n
`,
			result: [
				[
					{
						names: [
							"clang",
							`${getPrefixFromMSystem(msystem)}-clang`,
						],
						originalName: "clang",
						partialVersion: {
							major: 20,
						},
						type: "normal",
					},
				],
				[
					{
						names: [
							"libc++",
							`${getPrefixFromMSystem(msystem)}-libc++`,
						],
						originalName: "libc++",
						partialVersion: {
							major: 20,
						},
						type: "normal",
					},
					{
						names: ["libunwind"],
						originalName: "libunwind",
						partialVersion: {
							major: 20,
						},
						type: "normal",
					},
				],
			],
		},
		{
			name: "gcc 14 with exact same libs",
			input: `
            gcc=14 gcc-libs=!
`,
			result: [
				[
					{
						names: ["gcc", `${getPrefixFromMSystem(msystem)}-gcc`],
						originalName: "gcc",
						partialVersion: {
							major: 14,
						},
						type: "normal",
					},
					{
						names: [
							"gcc-libs",
							`${getPrefixFromMSystem(msystem)}-gcc-libs`,
						],
						originalName: "gcc-libs",
						partialVersion: {
							classification: "same_as_rest",
							type: "requested",
						},
						type: "normal",
					},
				],
			],
		},
	]

	test.each(parseTestCases)(
		"parsing packagesSpecs works as expected: $name",
		async (testCase: ParseTest): Promise<void> => {
			//TODO
			const resolved = resolveRequestedPackageSpecs(
				testCase.input,
				msystem
			)

			expect(resolved).toEqual(testCase.result)
		}
	)
})
