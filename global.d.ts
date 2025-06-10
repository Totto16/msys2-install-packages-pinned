// global.d.ts or jest.custom-matchers.d.ts
import "jest"
import type { PartialVersion, RawPackage, MSystem } from "./helper"

declare global {
	namespace jest {
		interface Matchers<R, T extends string[]> {
			toOnlyHavePackages(
				values: T extends string[] ? (string | RegExp)[] : never
			): void
		}

		interface Matchers<R, T extends RawPackage[]> {
			toFindPackage(
				name: T extends RawPackage[] ? string : never,
				msystem: T extends RawPackage[] ? MSystem : never,
				version?: T extends RawPackage[] ? PartialVersion : never
			): void
		}
	}
}
