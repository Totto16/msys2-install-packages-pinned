import {
	extractPackages,
	getRawBody,
	getRepoLink,
	MSystem,
	type ExtractedPackagesReturnValue,
} from "./helper"

type TestCase = {
	architecture: MSystem
	invalidPackages: string[]
}

const testCases: TestCase[] = [
	// { architecture: "mingw32", invalidPackages: [] },
	//  { architecture: "mingw64", invalidPackages: [] },
	// 	{ architecture: "ucrt64", invalidPackages: [] },
	{ architecture: "clang64", invalidPackages: ["clang64.files.tar.zst.old"] },
	// 	{ architecture: "clangarm64", invalidPackages: [] },
]

const validReasons: string[] = [
	"sig package",
	".db file",
	".old file",
	"directory file",
]

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

				for (const error of result.errors.failed) {
					expect(invalidPackages).toContain(error)
				}
			},
			60 * 1000
		)
	}
)
