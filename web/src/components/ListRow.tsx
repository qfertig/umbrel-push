import type {MouseEventHandler, ReactNode} from 'react'

import {cn} from '@/lib/utils'

// The icon tile and row anatomy of umbrelOS's Settings list (routes/settings/_components/list-row.tsx)
export function ListIcon({children, className}: {children: ReactNode; className?: string}) {
	return (
		<span
			className={cn(
				'settings-list-icon flex size-[30px] shrink-0 items-center justify-center overflow-hidden rounded-8 border border-white/25 text-15 font-semibold text-white',
				className,
			)}
		>
			{children}
		</span>
	)
}

/**
 * One row. When `onClick` is set, a transparent button covers the row and the controls in `children` sit above it,
 * so a row can open something and still hold its own buttons (a button inside a button is not valid HTML).
 */
export function ListRow({
	icon,
	title,
	description,
	children,
	onClick,
	label,
	stackOnMobile,
}: {
	icon?: ReactNode
	title: ReactNode
	description?: ReactNode
	children?: ReactNode
	onClick?: MouseEventHandler
	/** Accessible name for the row's button when the visible title is not enough on its own */
	label?: string
	/** Below the sm breakpoint, put the controls on their own line under the title instead of squeezing the title */
	stackOnMobile?: boolean
}) {
	return (
		<div
			className={cn(
				'settings-list-row relative flex min-h-[72px] w-full items-center justify-between gap-x-4 gap-y-2.5 px-5 py-3.5 text-left first:rounded-t-24 last:rounded-b-24',
				'bg-linear-to-r from-transparent to-transparent hover:via-white/4',
				stackOnMobile && 'flex-wrap sm:flex-nowrap',
			)}
		>
			{onClick ? (
				<button
					type='button'
					aria-label={label}
					onClick={onClick}
					className='absolute inset-0 cursor-pointer rounded-[inherit] outline-hidden focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-inset active:bg-white/3'
				/>
			) : null}
			<span className={cn('pointer-events-none relative flex min-w-0 flex-1 items-center gap-2.5', stackOnMobile && 'basis-full sm:basis-0')}>
				{icon}
				<span className='flex min-w-0 flex-1 flex-col gap-1'>
					<span className='truncate text-14 leading-none font-medium -tracking-2 text-white/90'>{title}</span>
					{description ? <span className='truncate text-12 leading-tight -tracking-2 text-white/40'>{description}</span> : null}
				</span>
			</span>
			{children ? <div className={cn('pointer-events-none relative flex shrink-0 items-center', stackOnMobile && 'w-full sm:w-auto')}>{children}</div> : null}
		</div>
	)
}

export function ListGroup({children, label}: {children: ReactNode; label: string}) {
	return (
		<section aria-label={label}>
			<div className='settings-list-group divide-y divide-white/8 overflow-hidden rounded-24 bg-white/4'>{children}</div>
		</section>
	)
}
