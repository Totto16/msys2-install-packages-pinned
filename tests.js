const helper = require("./helper")

describe("helper module", () => {
	/*** @type {helper.MSystem[]} */
	const architectures = [
		"mingw32",
		"mingw64",
		"ucrt64",
		"clang64",
		"clangarm64",
	]

	/**
	 * @param {helper.MSystem} architecture
	 */
	function testFn(architecture) {
		//TODO
		//helper.extractPackages(reportError, html)
	}

	test.each(architectures)(
		"fetching packages works as expected on '%s'",
		testFn
	)
})
