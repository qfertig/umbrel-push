import {clsx, type ClassValue} from 'clsx'
import {extendTailwindMerge} from 'tailwind-merge'

// The design tokens add numeric font sizes, radii and tracking steps; teach the merger about them so
// `text-13` and `text-white/90` (or `rounded-8` and `rounded-full`) are not treated as conflicts.
const twMerge = extendTailwindMerge({
	// These sizes carry no line-height, so `text-13` must not cancel `leading-inter-trimmed`
	override: {conflictingClassGroups: {'font-size': []}},
	extend: {
		classGroups: {
			'font-size': [{text: ['9', '11', '12', '13', '14', '15', '16', '17', '19', '24', '32', '36', '48', '56']}],
			rounded: [{rounded: ['3', '4', '5', '6', '8', '10', '12', '15', '17', '20', '24']}],
			tracking: [{tracking: ['1', '2', '3', '4']}],
			leading: [{leading: ['inter-trimmed']}],
		},
	},
})

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}
