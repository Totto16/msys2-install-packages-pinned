"use strict"

import assert from "node:assert/strict"
import core from "@actions/core"
import exec from "@actions/exec"
import fs from "node:fs"
import http from "@actions/http-client"
import io from "@actions/io"
import path from "node:path"
import {
	getArchNameFromMSystem,
	resolvePackageSpecs,
	type MSystem,
	type ResolvedPackage,
} from "./helper"

let cmd: string | null = null

function setupCmd(): void {
	//TODO: don't hardcode this path, see https://github.com/msys2/setup-msys2/blob/main/main.js
	// const msysRootDir = path.join("C:", "msys64")

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
 */
async function runMsys(args: string[], opts: object): Promise<void> {
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
 */
async function pacman(
	args: string[],
	opts: object,
	cmd?: string
): Promise<void> {
	await runMsys([cmd ? cmd : "pacman", "--noconfirm"].concat(args), opts)
}

async function resolveTempFolder(
	folderOrEmpty: string | null
): Promise<string> {
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

async function downloadFile(
	fileUrl: string,
	fileName: string,
	downloadFolder: string | null = null
): Promise<string> {
	const folder = await resolveTempFolder(downloadFolder)
	const file = path.join(folder, fileName)
	const writeStream = fs.createWriteStream(file)

	const httpClient = new http.HttpClient()

	const result = await httpClient.get(fileUrl)

	if (result.message.statusCode != 200) {
		throw new Error(`Error in getting the file: ${fileUrl}`)
	}

	await new Promise<void>((resolve, reject) => {
		const stream = result.message.pipe(writeStream)

		stream.on("error", (err) => reject(err))
		stream.on("close", resolve)
	})

	return file
}

function windowsPathToLinuxPath(winPath: string): string {
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

async function installPackages(pkgs: ResolvedPackage[]): Promise<void> {
	const paths: [string[], string[]] = [[], []]

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

async function installPrerequisites(msystem: MSystem): Promise<void> {
	// update package index
	await pacman(["-Sy"], {})

	const archName = getArchNameFromMSystem(msystem)

	const zstd_arch_package = `mingw-w64-${archName}-zstd`

	await pacman(
		["-Sy", "--needed", "zstd", "libzstd", "tar", zstd_arch_package],
		{}
	)
}

async function installMultiplePackageSpecs(
	packages: ResolvedPackage[][],
	msystem: MSystem
): Promise<void> {
	await installPrerequisites(msystem)

	for (const pkgs of packages) {
		await installPackages(pkgs)
	}
}

function toMSystem(input: string): MSystem {
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
			return input.toLowerCase() as MSystem
		default:
			throw new Error(`'${input}' is no valid MSystem`)
	}
}

async function main(): Promise<void> {
	try {
		const os: string = core.platform.platform

		if (os != "win32") {
			throw new Error(
				`Action atm only supported on windows (win32): but are on: ${os}`
			)
		}

		const msystemInput: string = core.getInput("msystem", {
			required: false,
		})

		const installInput: string = core.getInput("install", {
			required: true,
		})

		const msystem: MSystem = toMSystem(msystemInput)

		setupCmd()

		const packageSpecs = await resolvePackageSpecs(installInput, msystem)

		await installMultiplePackageSpecs(packageSpecs, msystem)
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(error)
		} else {
			core.setFailed(`Invalid error thrown: ${error}`)
		}
	}
}

main()
