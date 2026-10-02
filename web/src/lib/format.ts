const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/**
 * 59309948928 becomes "59.3 GB" and 3861703426048 becomes "3.86 TB": decimal units with two decimals below 10 and one
 * below 100, the way umbrelOS's own Settings shows its memory and storage, so the numbers can be compared at a glance.
 */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '-'
	let value = bytes
	let unit = 0
	while (value >= 1000 && unit < UNITS.length - 1) {
		value /= 1000
		unit += 1
	}
	return `${value.toFixed(unit === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0)} ${UNITS[unit]}`
}

/** The fraction of `total` that `used` fills, kept visible (never zero) when something is in use. */
export function share(used: number, total: number): number {
	if (!(total > 0) || !(used > 0)) return 0
	return Math.min(1, Math.max(used / total, 0.015))
}
