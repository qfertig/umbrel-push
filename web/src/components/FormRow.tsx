import type {ReactNode} from 'react'

import {cn} from '@/lib/utils'

/** A titled group of form rows on the same grouped surface as umbrelOS's Settings lists */
export function FormGroup({title, action, children}: {title: string; action?: ReactNode; children: ReactNode}) {
	return (
		<section aria-label={title}>
			<div className='mb-2 flex min-h-[30px] items-center justify-between gap-3 px-1'>
				<h3 className='text-13 font-semibold -tracking-2 text-white/60'>{title}</h3>
				{action}
			</div>
			<div className='divide-y divide-white/8 overflow-hidden rounded-24 bg-white/4'>{children}</div>
		</section>
	)
}

/** One setting: its name (and what it means, only when that is not obvious) on the left, the control on the right */
export function FormRow({label, htmlFor, hint, children, className}: {label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode; className?: string}) {
	return (
		<div className={cn('flex min-h-[56px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-2.5', className)}>
			<div className='w-[170px] shrink-0'>
				<label htmlFor={htmlFor} className='text-14 font-medium -tracking-2 text-white/90'>
					{label}
				</label>
				{hint ? <p className='text-12 leading-tight text-white/40'>{hint}</p> : null}
			</div>
			<div className='flex min-w-0 flex-[1_1_220px] items-center justify-end gap-2'>{children}</div>
		</div>
	)
}

/** A line of text on a list row, for an empty list or a note under a group */
export function FormNote({children, className}: {children: ReactNode; className?: string}) {
	return <p className={cn('px-5 py-3.5 text-13 -tracking-2 text-white/45', className)}>{children}</p>
}
