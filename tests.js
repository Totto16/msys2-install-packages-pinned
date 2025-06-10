const helper = require("./helper")

describe("helper module", () => {
	/*** @type {helper.MSystem[]} */
	const msystems = ["mingw32", "mingw64", "ucrt64", "clang64", "clangarm64"]

	/**
	 * @param {helper.MSystem} msystem
	 */
	async function testFn(msystem) {
		/** @type {string} */
		const repoLink = helper.getRepoLink(msystem)

		/** @type {string} */
		const body = await helper.getRawBody(repoLink)

		/** @type {helper.ExtractedPackagesReturnValue} */
		const allRawPackages = helper.extractPackages(repoLink, body)
		//TODO: assert results
	}

	test.each(msystems)("fetching packages works as expected on '%s'", testFn)
})
