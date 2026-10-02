import type {ComponentProps, ReactNode} from 'react'

import {cn} from '@/lib/utils'

const sizes = {
	/** The 48px pill used in dialogs */
	default: 'h-12 rounded-full px-5 text-15',
	/** The 36px pill used in dense forms */
	short: 'h-9 rounded-full px-4 text-13',
	/** The 36px rounded rectangle for table cells */
	square: 'h-9 rounded-8 px-2.5 text-13 font-normal',
}

// After umbrelOS's Input (components/ui/input.tsx): white/4 fill, border brightens on focus
export function Input({
	className,
	invalid,
	sizeVariant = 'default',
	...props
}: Omit<ComponentProps<'input'>, 'size'> & {invalid?: boolean; sizeVariant?: keyof typeof sizes}) {
	return (
		<input
			className={cn(
				'flex w-full border-px bg-white/4 py-2 font-medium -tracking-1 text-white/70 transition-colors duration-300 placeholder:text-white/30 hover:bg-white/6 focus-visible:border-white/50 focus-visible:bg-white/10 focus-visible:text-white focus-visible:outline-hidden focus-visible:placeholder:text-white/40 disabled:cursor-not-allowed disabled:opacity-40 md:border-hpx',
				sizes[sizeVariant],
				invalid ? 'border-destructive2-lightest text-destructive2-lightest' : 'border-white/10',
				className,
			)}
			{...props}
		/>
	)
}

// A visible label above the field, so the placeholder is never the only label
export function Labeled({children, label}: {children: ReactNode; label: string}) {
	return (
		<label className='block'>
			<span className='mb-1.5 block px-[5px] text-12 -tracking-2 text-white/50'>{label}</span>
			{children}
		</label>
	)
}

export function InputError({children}: {children: ReactNode}) {
	return (
		<div role='alert' className='flex items-start gap-1 p-1 text-13 font-normal -tracking-2 text-destructive2-lightest select-text'>
			{children}
		</div>
	)
}
