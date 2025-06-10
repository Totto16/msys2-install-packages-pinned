import {
	extractPackages,
	getRawBody,
	getRepoLink,
	MSystem,
	type ExtractedPackagesReturnValue,
} from "./helper.js"

describe("helper module", () => {
	const msystems: MSystem[] = [
		"mingw32" /*  "mingw64", "ucrt64", "clang64", "clangarm64" */,
	]

	const validReasons: string[] = ["Sig "]

	async function testFn(msystem: MSystem): Promise<void> {
		const repoLink: string = getRepoLink(msystem)

		const body: string = await getRawBody(repoLink)

		const result: ExtractedPackagesReturnValue = extractPackages(
			repoLink,
			body
		)

		for (const skipped of result.errors.skipped) {
			expect(validReasons).toContain(skipped.reason)
		}
	}

	test.each(msystems)("fetching packages works as expected on '%s'", testFn)
})
