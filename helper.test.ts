import {
	extractPackages,
	getRawBody,
	getRepoLink,
	MSystem,
	type ExtractedPackagesReturnValue,
} from "./helper"

type TestCase = {
	architecture: MSystem
	invalidPackages: (string | RegExp)[]
}

const testCases: TestCase[] = [
	// { architecture: "mingw32", invalidPackages: [] },
	//  { architecture: "mingw64", invalidPackages: [] },
	// 	{ architecture: "ucrt64", invalidPackages: [] },
	{
		architecture: "clang64",
		invalidPackages: [
			/^(.*)\-(?:(\d*)\.(\d*)(?:\.(\d*))?(.*)\-(\d*))\-([^.]*)\.(.*)$/, // suffix after version
			/^(.*)\-(?:(\d*~)?(\d*)\.(\d*)(?:\.(\d*)(?:\.(\d*))?)?\-(\d*))\-([^.]*)\.(.*)$/, // <number>~ prefix + 4 numbers
			/^(.*)\-(?:([0-9a-fA-Fr]*)\.([0-9a-fA-Fr]*)(?:\.([0-9a-fA-Fr]*))?\-([0-9a-fA-Fr]*))\-([^.]*)\.(.*)$/, // also allow hex numbers + r for revision
		],
	},
	// 	{ architecture: "clangarm64", invalidPackages: [] },
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
})

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
			},
			60 * 1000
		)
	}
)
