import {describe, expect, it} from 'vitest'

import {formatBytes, share} from './format'

describe('formatBytes', () => {
	it('uses decimal units, two decimals below 10 and one below 100, like umbrelOS', () => {
		expect(formatBytes(0)).toBe('0 B')
		expect(formatBytes(1536)).toBe('1.54 KB')
		expect(formatBytes(90_000_000)).toBe('90.0 MB')
		expect(formatBytes(2.1 * 1024 ** 3)).toBe('2.25 GB')
		expect(formatBytes(412e9)).toBe('412 GB')
		expect(formatBytes(2e12)).toBe('2.00 TB')
	})

	it("matches the numbers umbrelOS's own Settings page showed for the same Umbrel", () => {
		expect(formatBytes(59_309_948_928)).toBe('59.3 GB') // storage used
		expect(formatBytes(3_861_703_426_048)).toBe('3.86 TB') // storage size
		expect(formatBytes(7_731_413_160)).toBe('7.73 GB') // memory used
		expect(formatBytes(24_905_310_208)).toBe('24.9 GB') // memory size
	})

	it('refuses nonsense instead of printing it', () => {
		expect(formatBytes(-1)).toBe('-')
		expect(formatBytes(Number.NaN)).toBe('-')
	})
})

describe('share', () => {
	it('is the fraction used, with a visible sliver when anything is in use', () => {
		expect(share(50, 100)).toBe(0.5)
		expect(share(1, 1_000_000)).toBe(0.015)
		expect(share(0, 100)).toBe(0)
		expect(share(200, 100)).toBe(1)
		expect(share(10, 0)).toBe(0)
	})
})
