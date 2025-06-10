"use strict"

const assert = require("node:assert/strict")
const core = require("@actions/core")
const exec = require("@actions/exec")
const fs = require("node:fs")
const http = require("@actions/http-client")
const io = require("@actions/io")
const path = require("node:path")
const helper = require("./helper.js")

/** @type {string|null} */
let cmd = null

/**
 *
 * @returns {void}
 */
function setupCmd() {
	//TODO: don't hardcode this path, see https://github.com/msys2/setup-msys2/blob/main/main.js

	const msysRootDir = path.join("C:", "msys64")

	const tmp_dir = process.env["RUNNER_TEMP"]
	if (!tmp_dir) {
		core.setFailed("environment variable RUNNER_TEMP is undefined")
		return
	}

	const pathDir = path.join(tmp_dir, "setup-msys2")

	cmd = path.join(pathDir, "msys2.cmd")
}

/**
 * @see https://github.com/msys2/setup-msys2/blob/main/main.js#L304
 * @param {string[]} args
 * @param {object} opts
 */
async function runMsys(args, opts) {
	assert.ok(cmd)
	const quotedArgs = args.map((arg) => {
		return `'${arg.replace(/'/g, `'\\''`)}'`
	}) // fix confused vim syntax highlighting with: `
	await exec.exec(
		"cmd",
		["/D", "/S", "/C", cmd].concat(["-c", quotedArgs.join(" ")]),
		opts
	)
}

/**
 * @see https://github.com/msys2/setup-msys2/blob/main/main.js#L310C1-L317C2
 * @param {string[]} args
 * @param {object} opts
 * @param {string} [cmd]
 */
async function pacman(args, opts, cmd) {
	await runMsys([cmd ? cmd : "pacman", "--noconfirm"].concat(args), opts)
}

/**
 *
 * @async
 * @param {string|null} folderOrEmpty
 * @returns {Promise<string>}
 */
async function resolveTempFolder(folderOrEmpty) {
	let finalFolder = folderOrEmpty

	if (finalFolder == null) {
		const tmpDir = process.env["RUNNER_TEMP"]
		if (!tmpDir) {
			throw new Error("environment variable RUNNER_TEMP is undefined")
		}

		await io.mkdirP(tmpDir)

		finalFolder = path.join(tmpDir, "msys2-pinned-packages")
	}

	await io.mkdirP(finalFolder)

	return finalFolder
}

/**
 *
 * @param {string} fileUrl
 * @param {string} fileName
 * @param {string|null} downloadFolder
 * @returns {Promise<string>}
 */
async function downloadFile(fileUrl, fileName, downloadFolder = null) {
	const folder = await resolveTempFolder(downloadFolder)
	const file = path.join(folder, fileName)
	const writeStream = fs.createWriteStream(file)

	const httpClient = new http.HttpClient()

	const result = await httpClient.get(fileUrl)

	if (result.message.statusCode != 200) {
		throw new Error(`Error in getting the file: ${fileUrl}`)
	}

	await /** @type {Promise<void>} */ (
		new Promise((resolve, reject) => {
			const stream = result.message.pipe(writeStream)

			stream.on("error", (err) => reject(err))
			stream.on("close", resolve)
		})
	)

	return file
}

/**
 *
 * @param {string} winPath
 * @returns {string}
 */
function windowsPathToLinuxPath(winPath) {
	// Normalize path separators and remove drive colon

	const path = winPath.replace(/\\/g, "/") // Convert backslashes to forward slashes

	const match = path.match(/^([a-zA-Z]):(\/.*)/)
	if (match !== null) {
		const driveLetter = match[1].toLowerCase()
		const rest = match[2]
		return `/${driveLetter}${rest}`
	} else {
		// If path doesn't match the expected pattern, return as-is
		return path
	}
}

/**
 * @async
 * @param {helper.ResolvedPackage[]} pkgs
 * @returns {Promise<void>}
 */
async function installPackages(pkgs) {
	/** @type {[string[], string[]]} */
	const paths = [[], []]

	for (const pkg of pkgs) {
		if (pkg.type === "virtual") {
			paths[0].push(pkg.name)
			continue
		}

		core.info(`Downloading package '${pkg.name}' with url '${pkg.fullUrl}'`)
		const pkgPath = await downloadFile(pkg.fullUrl, pkg.name)
		const linuxPkgPath = windowsPathToLinuxPath(pkgPath)
		paths[0].push(linuxPkgPath)
		paths[1].push(pkgPath)
	}

	await pacman(["-U", ...paths[0]], {})

	for (const pkgPath of paths[1]) {
		await io.rmRF(pkgPath)
	}
}

/**
 *
 * @param {helper.MSystem} msystem
 * @returns {Promise<void>}
 */
async function installPrerequisites(msystem) {
	// update package index
	await pacman(["-Sy"], {})

	const archName = helper.getArchNameFromMSystem(msystem)

	const zstd_arch_package = `mingw-w64-${archName}-zstd`

	await pacman(
		["-Sy", "--needed", "zstd", "libzstd", "tar", zstd_arch_package],
		{}
	)
}

/**
 * @async
 * @param {helper.ResolvedPackage[][]} packages
 * @param {helper.MSystem} msystem
 * @returns {Promise<void>}
 */
async function installMultiplePackageSpecs(packages, msystem) {
	await installPrerequisites(msystem)

	for (const pkgs of packages) {
		await installPackages(pkgs)
	}
}

/**
 *
 * @param {string} input
 * @returns {helper.MSystem}
 */
function toMSystem(input) {
	switch (input.toLowerCase()) {
		case "clang32":
			throw new Error(
				"MSystem 'clang32' is deprecated and can't be used anymore!"
			)
		case "mingw64arm":
			throw new Error("MSystem 'mingw64arm' is unimplemented for this!")
		case "msys":
			throw new Error("MSystem 'msys' is unimplemented for this!")
		case "mingw32":
		case "mingw64":
		case "ucrt64":
		case "clang64":
		case "clangarm64":
			return /** @type {helper.MSystem} */ (
				/** @type {any} */ input.toLowerCase()
			)
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

		if (os != "win32") {
			throw new Error(
				`Action atm only supported on windows (win32): but are on: ${os}`
			)
		}

		/** @type {string} */
		const msystemInput = core.getInput("msystem", { required: false })

		/** @type {string} */
		const installInput = core.getInput("install", {
			required: true,
		})

		/** @type {helper.MSystem} */
		const msystem = toMSystem(msystemInput)

		setupCmd()

		const packageSpecs = await helper.resolvePackageSpecs(
			installInput,
			msystem
		)

		await installMultiplePackageSpecs(packageSpecs, msystem)
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
