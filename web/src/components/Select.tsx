import {ChevronDown} from 'lucide-react'
import type {ComponentProps} from 'react'

import {cn} from '@/lib/utils'

/** A native select (so the keyboard and screen readers work as people expect) in the pill look of the other inputs */
export function Select({className, children, ...props}: ComponentProps<'select'>) {
	return (
		<div className={cn('relative', className)}>
			<select
				className='h-9 w-full appearance-none rounded-full border-px border-white/10 bg-white/4 pr-9 pl-4 text-13 font-medium -tracking-1 text-white/80 transition-colors duration-300 hover:bg-white/6 focus-visible:border-white/50 focus-visible:bg-white/10 focus-visible:text-white focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-40 md:border-hpx'
				{...props}
			>
				{children}
			</select>
			<ChevronDown className='pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-white/50' aria-hidden='true' />
		</div>
	)
}
