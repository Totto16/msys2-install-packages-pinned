// global.d.ts or jest.custom-matchers.d.ts
import "jest"

declare global {
	namespace jest {
		interface Matchers<R, T extends string[]> {
			toOnlyHavePackages(
				values: T extends string[] ?(string | RegExp)[] : never
			): void
		}
	}
}
